package com.trezor.app.restore

import com.trezor.app.attachments.AttachmentFormat
import com.trezor.app.attachments.AttachmentLocations
import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.backup.BackupFiles
import com.trezor.app.backup.BackupFormatException
import com.trezor.app.backup.BackupManifest
import com.trezor.app.backup.BackupPassword
import com.trezor.app.backup.MemoryCheck
import com.trezor.app.backup.TzaSection
import com.trezor.app.backup.TzbkReader
import com.trezor.app.backup.TzbkSections
import com.trezor.app.reminders.ScheduleRestore
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Restore preparation without Android types (Phase 6 spec v2.4 §8.1–8.4, §8.6, §9.2–9.3):
 * the native steps of §8.2 up to step 12 and the pre-swap failure path. The JS coordinator
 * (`src/backup/restore.ts`) calls them one by one under the restore gate and runs the
 * SQLCipher work itself (step 6, step 9). One restore session at a time.
 *
 * Step 3 of the implementation plan stops here: the swap, its recovery and the restart call
 * (§8.2 steps 13–16, §8.5) are Step 4. Until then every preparation ends in [abort], so the
 * live database and attachment root are never moved, renamed or written: preparation only
 * creates `D/restore`, `N/restore`, `N/quarantine/<restoreId>` and links into the latter.
 */
class RestoreService(
    private val layout: RestoreLayout,
    private val ops: RestoreFileOps,
    /** The device `attachments` key (`AttachmentKeys.obtain` over every location, §8.6). */
    private val attachmentsKey: () -> ByteArray,
    private val freeBytes: (File) -> Long,
    /** The filesystem of a path (`Os.stat(path).st_dev`), to sum the space per filesystem (§9.6). */
    private val deviceOf: (File) -> Long,
    private val now: () -> Long = System::currentTimeMillis,
    private val random: SecureRandom = SecureRandom(),
    private val memory: MemoryCheck = MemoryCheck.RUNTIME,
) {

  val journals = JournalStore(layout, ops)
  private val quarantine = Quarantine(layout, ops)

  class Begun(val sessionId: String, val backupId: String, val attachments: Int, val databaseBytes: Long)

  /** [sqlcipherKey] opens `incoming.db`; the caller zeroes it. */
  class Staged(
      val restoreId: String,
      val backupId: String,
      val trailer: String,
      val manifest: BackupManifest,
      val sqlcipherKey: ByteArray,
  )

  private class Session(val id: String, val input: InputStream, val reader: TzbkReader, val manifest: BackupManifest) {
    /** The journal this session writes, set before its first durable write is attempted. */
    var journal: RestoreJournal? = null
    /** Whether that first write completed (the file may exist on disk even if it didn't). */
    var journalWritten = false
    var staged = false
  }

  private var session: Session? = null

  // --- §8.1 preconditions ----------------------------------------------------------------

  sealed class Preflight {
    object Ready : Preflight()
    /** No database file: the restore entry isn't offered, only Retry (§8.1 precondition 5). */
    object NotOffered : Preflight()
    class Refused(val code: String) : Preflight()
  }

  /**
   * The preconditions of §8.1, in the spec's order after the database-file check that decides
   * whether the entry exists at all. [databaseKeyUsable] gets and zeroes `vault.getKey('database')`;
   * [attachmentsKey] is `null` when the key doesn't exist, else whether it unwraps.
   *
   * A journal, or restore staging left without one, is `RESTORE_STATE_UNKNOWN` here: the
   * recovery that would handle them (§8.5) is Step 4.
   */
  fun preflight(fromErrorScreen: Boolean, databaseKeyUsable: () -> Boolean, attachmentsKey: () -> Boolean?): Preflight {
    if (!layout.liveDb.isFile) return Preflight.NotOffered
    if (!databaseKeyUsable()) return Preflight.Refused(RestoreException.UNAVAILABLE)
    when (attachmentsKey()) {
      true -> Unit
      false -> return Preflight.Refused(RestoreException.UNAVAILABLE)
      null ->
          try {
            if (AttachmentLocations.hasAnyFile(layout.noBackupDir)) return Preflight.Refused(RestoreException.UNAVAILABLE)
          } catch (e: Exception) {
            return Preflight.Refused(RestoreException.UNAVAILABLE)
          }
    }
    if (layout.journal.exists() || layout.restoreDir.exists() || layout.restoreDbDir.exists()) {
      return Preflight.Refused(RestoreException.STATE_UNKNOWN)
    }
    if (fromErrorScreen && layout.liveDbJournal.exists()) return Preflight.Refused(RestoreException.STATE_UNKNOWN)
    return Preflight.Ready
  }

  // --- §8.2 step 1 -------------------------------------------------------------------------

  /**
   * Step 1: password rules, memory, Argon2id, the manifest, and free space (§9.6). Nothing is
   * written. The session keeps [input] open; [stage] reads the rest of it.
   */
  @Synchronized
  fun begin(input: InputStream, password: String): Begun {
    check(session == null) { "A restore is already running" }
    try {
      // A journal, or restore files left without one (review M-A), belong to an earlier
      // restore: refused before any session or gate exists, and left untouched.
      if (layout.journal.exists() || layout.restoreDir.exists() || layout.restoreDbDir.exists()) {
        throw RestoreException(RestoreException.STATE_UNKNOWN, "Restore files exist")
      }
      val pw = BackupPassword.encode(password)
      val reader =
          try {
            TzbkReader.open(input, pw, memory)
          } finally {
            pw.fill(0)
          }
      try {
        val manifest = BackupManifest.decode(reader.readManifest())
        requireSpace(manifest)
        val s = Session(hex(bytes(16)), input, reader, manifest)
        session = s
        return Begun(s.id, hex(reader.header.backupId), manifest.attachments.size, manifest.database.sizeBytes)
      } catch (e: Throwable) {
        reader.close()
        throw e
      }
    } catch (e: Throwable) {
      runCatching { input.close() }
      throw e
    }
  }

  /** §9.6: `incoming.db` + `S_db` + Σ `tzaSizeBytes` (+ the one section in transit) + 16 MiB, per filesystem. */
  private fun requireSpace(manifest: BackupManifest) {
    val db = manifest.database.sizeBytes
    val tza = manifest.attachments.sumOf { it.tzaSizeBytes }
    val largest = manifest.attachments.maxOfOrNull { it.tzaSizeBytes } ?: 0L
    val needs = linkedMapOf<Long, Pair<File, Long>>()
    fun add(dir: File, bytes: Long) {
      val device = deviceOf(dir)
      val (path, sum) = needs[device] ?: (dir to 0L)
      needs[device] = path to sum + bytes
    }
    add(layout.databaseDir, 2 * db)
    add(layout.noBackupDir, tza + largest)
    for ((path, bytes) in needs.values) {
      val needed = bytes + BackupFiles.MARGIN_BYTES
      val available = freeBytes(path)
      if (available < needed) throw BackupFiles.InsufficientSpace(needed, available)
    }
  }

  // --- §8.2 steps 3–5 ----------------------------------------------------------------------

  /**
   * Steps 3–5, under the restore gate: the journal (`prepared`); `S_att` (always, H1) and
   * `fsync N/restore`; the database section into `D/restore/incoming.db`; every attachment
   * section verified (Annex A §A.4), its DEK rewrapped to the device key into `S_att/<id>.tza`
   * and that file decrypted again under the device key; the trailer and EOF; then, if a Check
   * ran before, the same backup ID and trailer (§8.3, else `BACKUP_CHANGED`).
   *
   * On failure after the journal was written, everything stays for [abort].
   */
  fun stage(sessionId: String, expectedBackupId: String?, expectedTrailer: String?): Staged {
    val s = synchronized(this) { current(sessionId) }
    check(!s.staged && s.journal == null) { "Already staged" }
    s.input.use {
      s.reader.use { reader ->
        if (!layout.liveDb.isFile) throw RestoreException(RestoreException.STATE_UNKNOWN, "No database file")
        // Anything under N/restore or D/restore now belongs to an earlier restore, not this one.
        if (layout.restoreDir.exists() || layout.restoreDbDir.exists()) {
          throw RestoreException(RestoreException.STATE_UNKNOWN, "Restore files exist")
        }
        // Step 3. hadDatabase is always true (§8.1 precondition 5).
        val journal =
            RestoreJournal(
                restoreId = hex(bytes(16)),
                backupId = hex(reader.header.backupId),
                phase = RestoreJournal.Phase.PREPARED,
                hadAttachments = layout.liveAttachments.isDirectory,
                scheduleSaved = RestoreJournal.Schedule.PENDING,
                createdAt = now(),
            )
        // Tracked before the write: a failure part-way (directory created, temp file left,
        // or renamed but not synced) is then still this session's to clean up in abort.
        s.journal = journal
        ops.mkdirDurable(layout.restoreDir)
        journals.write(journal)
        s.journalWritten = true
        // Step 4.
        ops.mkdirDurable(layout.stagedAttachments)
        ops.mkdirDurable(layout.restoreDbDir)
        stageDatabase(reader, s.manifest)
        val attachments = s.manifest.attachments
        if (attachments.isNotEmpty()) {
          val wrapKey = reader.attachmentWrapKey()
          val deviceKey = attachmentsKey()
          try {
            attachments.forEachIndexed { i, a -> stageAttachment(reader, i, a, wrapKey, deviceKey) }
          } finally {
            wrapKey.fill(0)
            deviceKey.fill(0)
          }
        }
        reader.finish(attachments.size)
        val trailer = hex(reader.trailer!!)
        // Step 5.
        if (expectedBackupId != null || expectedTrailer != null) {
          if (expectedBackupId != journal.backupId || expectedTrailer != trailer) {
            throw RestoreException(RestoreException.BACKUP_CHANGED, "Backup differs from the one checked")
          }
        }
        s.staged = true
        return Staged(journal.restoreId, journal.backupId, trailer, s.manifest, reader.sqlcipherKey())
      }
    }
  }

  private fun stageDatabase(reader: TzbkReader, manifest: BackupManifest) {
    val digest = MessageDigest.getInstance("SHA-256")
    val length =
        FileOutputStream(layout.incoming).use { out ->
          val n = reader.readDatabase(DigestOutput(out, digest))
          out.fd.sync()
          n
        }
    if (length != manifest.database.sizeBytes || hex(digest.digest()) != manifest.database.sha256) {
      throw BackupFormatException(BackupFormatException.Code.BACKUP_INCONSISTENT, "Database section doesn't match the manifest")
    }
  }

  private fun stageAttachment(reader: TzbkReader, ordinal: Int, a: BackupManifest.Attachment, wrapKey: ByteArray, deviceKey: ByteArray) {
    require(AttachmentStore.ID_PATTERN.matches(a.id)) { "Invalid attachment id" }
    val transit = layout.incomingAttachment
    val target = File(layout.stagedAttachments, "${a.id}${AttachmentStore.SUFFIX}")
    if (target.exists()) throw RestoreException(RestoreException.STATE_UNKNOWN, "Staged attachment exists")
    try {
      // The section as read: a TZA file whose DEK is wrapped under the backup's wrap key.
      FileOutputStream(transit).use { out ->
        reader.readAttachment(ordinal, a.tzaSizeBytes, out)
        out.fd.sync()
      }
      // Annex A §A.4: the header rules, then the whole body decrypted and authenticated.
      FileInputStream(transit).use { input ->
        val header = ByteArray(AttachmentFormat.HEADER_BYTES)
        TzbkSections.readExactly(input, header, header.size) { corrupt("Attachment header truncated") }
        TzaSection.checkHeader(header)
        expectMatch(a, decrypt(java.io.SequenceInputStream(header.inputStream(), input), a.id, wrapKey))
      }
      // Rewrap the DEK to the device key; the body is copied unchanged and bounded.
      FileInputStream(transit).use { input ->
        FileOutputStream(target).use { out ->
          AttachmentFormat.rewrap(input, out, a.id, wrapKey, deviceKey, a.tzaSizeBytes, random)
          out.fd.sync()
        }
      }
      // And the written file, decrypted again under the device key.
      FileInputStream(target).use { expectMatch(a, decrypt(it, a.id, deviceKey)) }
    } finally {
      transit.delete()
    }
  }

  private fun decrypt(input: InputStream, id: String, key: ByteArray): AttachmentFormat.Result =
      try {
        AttachmentFormat.decrypt(input, Discard, id, key)
      } catch (e: AttachmentFormat.FormatException) {
        throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, "Attachment invalid", e)
      }

  private fun expectMatch(a: BackupManifest.Attachment, result: AttachmentFormat.Result) {
    if (result.sizeBytes != a.sizeBytes || result.sha256 != a.sha256) {
      throw BackupFormatException(BackupFormatException.Code.BACKUP_INCONSISTENT, "Attachment doesn't match the manifest")
    }
  }

  // --- §8.2 step 6 (file part), 7, 8 ---------------------------------------------------------

  /** End of step 6: `incoming.db` is no longer needed once `S_db` is written and checked. */
  fun deleteIncoming(sessionId: String) {
    current(sessionId)
    if (layout.incoming.exists() && !layout.incoming.delete()) throw IOException("Could not delete the staged artifact")
    ops.syncDirectory(layout.restoreDbDir)
  }

  /** Steps 7–8: the retained files into quarantine, then `fsync` of every staged file and directory. */
  fun preserveRetained(sessionId: String): Quarantine.Outcome {
    val s = current(sessionId)
    val journal = s.journal ?: throw IllegalStateException("Not staged")
    check(s.staged) { "Not staged" }
    if (!layout.stagedDb.isFile || layout.incoming.exists()) {
      throw RestoreException(RestoreException.STATE_UNKNOWN, "Staged database missing")
    }
    val outcome = quarantine.preserve(journal.restoreId)
    ops.syncFile(layout.stagedDb)
    layout.stagedAttachments.listFiles()?.forEach { ops.syncFile(it) }
    ops.syncDirectory(layout.stagedAttachments)
    ops.syncDirectory(layout.restoreDbDir)
    ops.syncDirectory(layout.restoreDir)
    val q = layout.quarantine(journal.restoreId)
    if (q.isDirectory) ops.syncDirectory(q)
    if (layout.quarantineRoot.isDirectory) ops.syncDirectory(layout.quarantineRoot)
    return outcome
  }

  // --- §8.2 steps 10–11 --------------------------------------------------------------------

  /** One call under the `ScheduleStore` monitor: save, record in the journal, clear, confirm. */
  fun saveAndClearSchedule(sessionId: String, schedule: ScheduleRestore): RestoreJournal.Schedule {
    val s = current(sessionId)
    val journal = s.journal ?: throw IllegalStateException("Not staged")
    val saved =
        schedule.saveAndClear { state ->
          val updated =
              journal.copy(scheduleSaved = if (state == ScheduleRestore.Saved.SAVED) RestoreJournal.Schedule.SAVED else RestoreJournal.Schedule.ABSENT)
          journals.write(updated)
          s.journal = updated
        }
    return if (saved == ScheduleRestore.Saved.SAVED) RestoreJournal.Schedule.SAVED else RestoreJournal.Schedule.ABSENT
  }

  // --- Pre-swap failure (§8.2) ---------------------------------------------------------------

  /**
   * The pre-swap failure path: restore the schedule (§8.11), delete `D/restore`,
   * `N/restore/attachments` and `N/quarantine/<restoreId>`, then the journal (and `N/restore`
   * once it is empty). In Step 3 every preparation ends here.
   *
   * - An unknown session is refused (IllegalStateException), never reported as done.
   * - Without a journal on disk: if this session started writing one, only what that write
   *   leaves (an empty `N/restore`, `restore.json.tmp`) is removed; anything else under
   *   `N/restore` or `D/restore` is not this session's to judge: `RESTORE_RECOVERY_RETRY`.
   * - A failing action stops at once and keeps the journal and every remaining file:
   *   `RESTORE_RECOVERY_RETRY`. The session is kept, so calling [abort] again resumes from
   *   the files (every action is idempotent); it is forgotten only once cleanup succeeded.
   */
  fun abort(sessionId: String, schedule: ScheduleRestore) {
    val s = synchronized(this) { current(sessionId) }
    try {
      runCatching { s.reader.close() }
      runCatching { s.input.close() }
      val journal = journals.read()
      if (journal == null) {
        // Only if this session's first journal write never completed: a journal it did
        // write that is now gone is ambiguous, so nothing is deleted then.
        if (s.journal != null && !s.journalWritten) removeUnwrittenJournal()
        if (layout.restoreDir.exists() || layout.restoreDbDir.exists()) {
          throw RestoreException(RestoreException.RECOVERY_RETRY, "Restore files without a journal")
        }
      } else {
        if (journal.restoreId != s.journal?.restoreId) {
          throw RestoreException(RestoreException.STATE_UNKNOWN, "Journal belongs to another restore")
        }
        schedule.restoreAndRearm(
            when (journal.scheduleSaved) {
              RestoreJournal.Schedule.PENDING -> ScheduleRestore.Saved.PENDING
              RestoreJournal.Schedule.SAVED -> ScheduleRestore.Saved.SAVED
              RestoreJournal.Schedule.ABSENT -> ScheduleRestore.Saved.ABSENT
            })
        ops.deleteRecursively(layout.restoreDbDir)
        ops.deleteRecursively(layout.stagedAttachments)
        ops.deleteRecursively(layout.quarantine(journal.restoreId), journal.restoreId)
        if (layout.incomingAttachment.exists() && !layout.incomingAttachment.delete()) throw IOException("Could not delete a staged section")
        journals.delete()
        if (layout.restoreDir.listFiles()?.isEmpty() == true) ops.deleteRecursively(layout.restoreDir)
      }
    } catch (e: RestoreException) {
      throw if (e.code == RestoreException.STATE_UNKNOWN || e.code == RestoreException.RECOVERY_RETRY) e
      else RestoreException(RestoreException.RECOVERY_RETRY, "Restore cleanup failed", e)
    } catch (e: Exception) {
      throw RestoreException(RestoreException.RECOVERY_RETRY, "Restore cleanup failed", e)
    }
    synchronized(this) { if (session === s) session = null }
  }

  /** What a failed first journal write of this session can leave: `restore.json.tmp`, an empty `N/restore`. */
  private fun removeUnwrittenJournal() {
    if (!layout.restoreDir.exists()) return
    if (layout.journalTmp.exists() && !layout.journalTmp.delete()) throw IOException("Could not delete the journal temp file")
    if (layout.restoreDir.listFiles()?.isEmpty() == true) ops.deleteRecursively(layout.restoreDir)
  }

  /** Closes the session's file (module shutdown). Leaves files and journal as they are. */
  @Synchronized
  fun release() {
    session?.let {
      runCatching { it.reader.close() }
      runCatching { it.input.close() }
    }
    session = null
  }

  @Synchronized
  private fun current(sessionId: String): Session =
      session?.takeIf { it.id == sessionId } ?: throw IllegalStateException("No such restore session")

  private fun bytes(n: Int) = ByteArray(n).also(random::nextBytes)

  private fun corrupt(message: String): Nothing = throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, message)

  private object Discard : OutputStream() {
    override fun write(b: Int) {}

    override fun write(b: ByteArray, off: Int, len: Int) {}
  }

  private class DigestOutput(private val out: OutputStream, private val digest: MessageDigest) : OutputStream() {
    override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

    override fun write(b: ByteArray, off: Int, len: Int) {
      digest.update(b, off, len)
      out.write(b, off, len)
    }
  }

  companion object {
    internal fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
  }
}
