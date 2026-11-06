package com.trezor.app.backup

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.SecureRandom

/**
 * Backup creation and Check backup without Android types (spec v2.4 §6, §7); the native
 * module only adds the document picker and JSON. One backup session at a time:
 *
 * 1. [begin]: password rules, free space, Argon2id, a new BMK, header and keys. Returns the
 *    SQLCipher artifact key for the JS export (the narrow exception of §5).
 * 2. [setDestination]: the picked document must report size 0.
 * 3. [write]: under [BackupGate], the complete file from the export and its rows; then
 *    `fsync`, close and the final size, which must equal the bytes written.
 * 4. [readBack]: the file read back completely ([BackupChecker], with the session's KEK);
 *    JS then checks the staged database.
 * 5. [complete] or [abort] (deletes the destination where the provider allows it).
 */
class BackupService(
    private val files: BackupFiles,
    /** The device `attachments` key, or null if it doesn't exist; never created here. */
    private val attachmentsKey: () -> ByteArray?,
    private val fileOf: (String) -> File,
    private val app: BackupManifest.App,
    private val liveDatabaseBytes: () -> Long,
    private val now: () -> Long = System::currentTimeMillis,
    private val random: SecureRandom = SecureRandom(),
    private val memory: MemoryCheck = MemoryCheck.RUNTIME,
) {

  /** A picked document: platform-free so the rules are covered by JVM tests. */
  interface Destination {
    /** Size the provider reports, or null when it doesn't. */
    fun size(): Long?

    /** Opens for writing, truncating ("wt", else "w"). */
    fun openForWrite(): Output

    fun openForRead(): InputStream

    /** Deletes the document; false if the provider doesn't allow it. */
    fun delete(): Boolean

    interface Output : AutoCloseable {
      val stream: OutputStream

      /** `fsync`; throws if the provider can't make the data durable. */
      fun sync()
    }
  }

  class DestinationException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

  class Begun(val sessionId: String, val exportDir: File, val exportName: String, val sqlcipherKey: ByteArray)

  class Staged(val checkId: String, val result: BackupChecker.Result)

  private class Session(
      val id: String,
      val header: TzbkHeader,
      val keys: TzbkKeys,
      val kek: ByteArray,
      val exportName: String,
  ) {
    var destination: Destination? = null
  }

  private var session: Session? = null

  @Synchronized
  fun begin(password: String, confirmation: String): Begun {
    check(session == null) { "A backup is already running" }
    val pw = BackupPassword.encodeConfirmed(password, confirmation)
    val bmk = ByteArray(Tzbk.KEY_BYTES).also(random::nextBytes)
    try {
      // The export is about the size of the live database (spec §9.6).
      files.requireFree(liveDatabaseBytes())
      val unsealed =
          TzbkHeader.unsealed(
              salt = bytes(Tzbk.SALT_BYTES),
              backupId = bytes(Tzbk.BACKUP_ID_BYTES),
              noncePrefix = bytes(Tzbk.NONCE_PREFIX_BYTES),
              wrapIv = bytes(Tzbk.IV_BYTES))
      val kek = TzbkCrypto.kek(pw, unsealed, memory)
      val header = TzbkHeader.sealed(unsealed, TzbkCrypto.wrapBmk(kek, bmk, unsealed))
      val keys = TzbkKeys(bmk, header.backupId)
      val s = Session(hex(bytes(16)), header, keys, kek, files.newExportName())
      session = s
      return Begun(s.id, files.exportDir, s.exportName, keys.sqlcipher())
    } finally {
      pw.fill(0)
      bmk.fill(0)
    }
  }

  /** The picked destination must show it is empty; one that doesn't is never written or deleted. */
  @Synchronized
  fun setDestination(sessionId: String, destination: Destination, record: String) {
    val s = current(sessionId)
    val size =
        try {
          destination.size()
        } catch (e: Exception) {
          null
        }
    if (size == null) throw DestinationException(DESTINATION_UNVERIFIED, "Destination size unknown")
    if (size > 0) throw DestinationException(DESTINATION_NOT_EMPTY, "Destination already has content")
    files.recordPendingDestination(record)
    s.destination = destination
  }

  /**
   * Writes the backup (spec §6.2 steps 5–6) and makes it durable; returns its length. The
   * gate protects every exported attachment from deletion until the output is closed.
   */
  fun write(sessionId: String, rows: List<BackupCreator.Row>): Long {
    val s = synchronized(this) { current(sessionId) }
    val destination = s.destination ?: throw IllegalStateException("No destination")
    val export = File(files.exportDir, s.exportName)
    BackupGate.begin(rows.map { it.id }.toSet())
    try {
      val key = if (rows.isEmpty()) null else attachmentsKey() ?: throw DestinationException(KEY_UNAVAILABLE, "Attachment key missing")
      try {
        val length =
            destination.openForWrite().use { out ->
              val n =
                  BackupCreator(fileOf, random)
                      .write(out.stream, s.header, s.keys, export, rows, app, now(), key)
              out.stream.flush()
              out.sync()
              n
            }
        val size =
            try {
              destination.size()
            } catch (e: Exception) {
              null
            }
        if (size != length) throw DestinationException(DESTINATION_UNVERIFIED, "Destination size doesn't match")
        return length
      } finally {
        key?.fill(0)
      }
    } finally {
      BackupGate.end()
      files.deleteExport(s.exportName)
    }
  }

  /** Reads the written file back completely (spec §6.2 step 7). JS checks the staged database. */
  fun readBack(sessionId: String): Staged {
    val s = synchronized(this) { current(sessionId) }
    val destination = s.destination ?: throw IllegalStateException("No destination")
    return stage { dir ->
      BackupChecker(dir, files::requireFree).check(destination.openForRead()) { TzbkReader.openWithKek(it, s.kek) }
    }
  }

  /** Check backup (spec §7 steps 1–5) for [input] with [password]; JS checks the staged database. */
  fun check(input: InputStream, password: String): Staged {
    val pw = BackupPassword.encode(password)
    try {
      return stage { dir -> BackupChecker(dir, files::requireFree).check(input) { TzbkReader.open(it, pw, memory) } }
    } finally {
      pw.fill(0)
    }
  }

  /** The staging file needs about the database's size (spec §9.6), checked once its size is known. */
  private fun stage(run: (File) -> BackupChecker.Result): Staged {
    val (id, dir) = files.newCheckDir()
    try {
      return Staged(id, run(dir))
    } catch (e: Throwable) {
      files.deleteCheck(id)
      throw e
    }
  }

  fun finishCheck(checkId: String) = files.deleteCheck(checkId)

  /** Success: forgets the destination record and the keys. */
  @Synchronized
  fun complete(sessionId: String) {
    current(sessionId)
    files.clearPendingDestination()
    release()
  }

  /**
   * Failure or cancellation: deletes the accepted destination where the provider allows
   * it (the picker created it, so it is ours even if nothing was written yet). Returns
   * "deleted", "remains" (couldn't be deleted) or "none" (no destination was accepted; a
   * refused one is never touched).
   */
  @Synchronized
  fun abort(sessionId: String): String {
    val s = session?.takeIf { it.id == sessionId } ?: return "none"
    val outcome =
        when {
          s.destination == null -> "none"
          runCatching { s.destination!!.delete() }.getOrDefault(false) -> "deleted"
          else -> "remains"
        }
    files.clearPendingDestination()
    files.deleteExport(s.exportName)
    release()
    return outcome
  }

  /** Zeroes and forgets the session (module shutdown). */
  @Synchronized
  fun release() {
    session?.let {
      it.kek.fill(0)
      it.keys.close()
    }
    session = null
  }

  private fun current(sessionId: String): Session =
      session?.takeIf { it.id == sessionId } ?: throw IllegalStateException("No such backup session")

  private fun bytes(n: Int) = ByteArray(n).also(random::nextBytes)

  companion object {
    const val DESTINATION_NOT_EMPTY = "DESTINATION_NOT_EMPTY"
    const val DESTINATION_UNVERIFIED = "DESTINATION_UNVERIFIED"
    const val KEY_UNAVAILABLE = "KEY_UNAVAILABLE"

    internal fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
  }
}
