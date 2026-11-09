package com.trezor.app.backup

import com.trezor.app.attachments.AttachmentFormat
import com.trezor.app.attachments.AttachmentStore
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.SequenceInputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Writes a complete backup file (spec v2.4 §6.2 steps 5–6) from the exported database
 * artifact and the attachment rows read **from that export**.
 *
 * Every attachment is checked completely before anything is written: its live `.tza` file
 * is decrypted and authenticated under the device key, and its size and SHA-256 must equal
 * the row. A missing, damaged or mismatching file fails the backup with
 * [AttachmentUnreadable]; an attachment is never left out. Its section is then the same
 * file with only the DEK re-wrapped (Annex A §A.5): the body is streamed unchanged, and its
 * digest must equal the one just verified.
 */
class BackupCreator(
    private val fileOf: (id: String) -> File,
    private val random: SecureRandom = SecureRandom(),
) {

  /** One `attachments` row of the exported database. */
  data class Row(
      val id: String,
      val itemId: String,
      val fileName: String,
      val mimeType: String,
      val sizeBytes: Long,
      val sha256: String,
      val formatVersion: Int,
  )

  /** Spec §6.2 step 5 (M-e): the backup stops; nothing is reported as a backup. */
  class AttachmentUnreadable(val attachmentId: String, val itemId: String, val reason: Reason, cause: Throwable? = null) :
      Exception("Attachment can't be backed up: $reason", cause) {
    enum class Reason {
      MISSING,
      DAMAGED,
      MISMATCH,
    }
  }

  /** The rows, sorted by id, each with the SHA-256 of its file's verified (encrypted) bytes. */
  class Verified internal constructor(val rows: List<Row>, internal val digests: Map<String, ByteArray>)

  /**
   * The format's limits, then every attachment file decrypted and authenticated under
   * [deviceKey] and compared with its row. Called before the destination is opened, so a
   * missing, damaged or mismatching file fails the backup before anything is opened or
   * written. [deviceKey] is the device `attachments` key (only needed when there are rows;
   * zeroed by the caller).
   */
  fun verify(rows: List<Row>, deviceKey: ByteArray?): Verified {
    val sorted = rows.sortedBy { it.id }
    if (sorted.isNotEmpty()) requireNotNull(deviceKey) { "Attachments need the device key" }
    // The format's limits (spec §3.8), before any file is read.
    if (sorted.size > Tzbk.MAX_ATTACHMENTS) tooLarge("Too many attachments")
    if (sorted.any { it.sizeBytes !in 0..Tzbk.MAX_ATTACHMENT_BYTES }) tooLarge("Attachment too large")
    if (sorted.sumOf { it.sizeBytes } > Tzbk.MAX_ATTACHMENT_TOTAL_BYTES) tooLarge("Attachments exceed 4 GiB")
    return Verified(sorted, sorted.associate { it.id to verify(it, deviceKey!!) })
  }

  /**
   * Writes the backup of [verified] to [output] (not closed) and returns its length. Each
   * attachment section must hash to what [verify] authenticated. [deviceKey] as for [verify].
   */
  fun write(
      output: OutputStream,
      header: TzbkHeader,
      keys: TzbkKeys,
      export: File,
      verified: Verified,
      app: BackupManifest.App,
      createdAt: Long,
      deviceKey: ByteArray?,
  ): Long {
    val sorted = verified.rows
    val digests = verified.digests

    val databaseBytes = export.length()
    if (databaseBytes > Tzbk.MAX_DATABASE_BYTES) tooLarge("Database too large")
    val manifest =
        BackupManifest(
            createdAt = createdAt,
            app = app,
            database = BackupManifest.Database(databaseBytes, sha256(export)),
            attachments =
                sorted.mapIndexed { i, r ->
                  BackupManifest.Attachment(
                      i, r.id, r.fileName, r.mimeType, r.sizeBytes, r.sha256, r.formatVersion, TzaSection.size(r.sizeBytes))
                },
        )

    var written = 0L
    val counting =
        object : OutputStream() {
          override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

          override fun write(b: ByteArray, off: Int, len: Int) {
            output.write(b, off, len)
            written += len
          }
        }
    val writer = TzbkWriter(counting, header, keys, sorted.size)
    writer.writeManifest(manifest.encode())
    FileInputStream(export).use { writer.writeDatabase(it, databaseBytes) }
    val wrapKey = keys.attachmentWrap()
    try {
      sorted.forEachIndexed { i, row -> writeSection(writer, i, row, deviceKey!!, wrapKey, digests.getValue(row.id)) }
    } finally {
      wrapKey.fill(0)
    }
    writer.finish()
    return written
  }

  /** Decrypts and authenticates [row]'s file; returns the SHA-256 of its encrypted bytes. */
  private fun verify(row: Row, deviceKey: ByteArray): ByteArray {
    if (!AttachmentStore.ID_PATTERN.matches(row.id)) inconsistent("Attachment id")
    val file = fileOf(row.id)
    if (!file.isFile) unreadable(row, AttachmentUnreadable.Reason.MISSING)
    if (file.length() != TzaSection.size(row.sizeBytes)) unreadable(row, AttachmentUnreadable.Reason.MISMATCH)
    val digest = MessageDigest.getInstance("SHA-256")
    try {
      DigestInputStream(FileInputStream(file), digest).use { input ->
        val header = ByteArray(AttachmentFormat.HEADER_BYTES)
        TzbkSections.readExactly(input, header, header.size) { unreadable(row, AttachmentUnreadable.Reason.DAMAGED) }
        try {
          TzaSection.checkHeader(header)
        } catch (e: BackupFormatException) {
          unreadable(row, AttachmentUnreadable.Reason.DAMAGED, e)
        }
        val result =
            AttachmentFormat.decrypt(SequenceInputStream(header.inputStream(), input), NullOutput, row.id, deviceKey)
        if (result.sizeBytes != row.sizeBytes || result.sha256 != row.sha256) {
          unreadable(row, AttachmentUnreadable.Reason.MISMATCH)
        }
      }
    } catch (e: AttachmentFormat.FormatException) {
      unreadable(row, AttachmentUnreadable.Reason.DAMAGED, e)
    } catch (e: IOException) {
      unreadable(row, AttachmentUnreadable.Reason.DAMAGED, e)
    }
    return digest.digest()
  }

  private fun writeSection(writer: TzbkWriter, ordinal: Int, row: Row, deviceKey: ByteArray, wrapKey: ByteArray, verified: ByteArray) {
    val file = fileOf(row.id)
    val length = TzaSection.size(row.sizeBytes)
    val digest = MessageDigest.getInstance("SHA-256")
    try {
      DigestInputStream(FileInputStream(file), digest).use { input ->
        val header = ByteArray(AttachmentFormat.HEADER_BYTES)
        TzbkSections.readExactly(input, header, header.size) { unreadable(row, AttachmentUnreadable.Reason.MISSING) }
        val rewrapped = AttachmentFormat.rewrapHeader(header, row.id, deviceKey, wrapKey, random)
        val body = LimitedInputStream(input, length - AttachmentFormat.HEADER_BYTES)
        writer.writeAttachment(ordinal, SequenceInputStream(rewrapped.inputStream(), body), length)
      }
    } catch (e: AttachmentFormat.FormatException) {
      unreadable(row, AttachmentUnreadable.Reason.DAMAGED, e)
    } catch (e: IllegalArgumentException) {
      // The file is shorter or longer than when it was verified.
      unreadable(row, AttachmentUnreadable.Reason.MISMATCH, e)
    }
    // The bytes copied are the bytes that were authenticated.
    if (!MessageDigest.isEqual(verified, digest.digest())) unreadable(row, AttachmentUnreadable.Reason.MISMATCH)
  }

  private fun unreadable(row: Row, reason: AttachmentUnreadable.Reason, cause: Throwable? = null): Nothing =
      throw AttachmentUnreadable(row.id, row.itemId, reason, cause)

  private object NullOutput : OutputStream() {
    override fun write(b: Int) {}

    override fun write(b: ByteArray, off: Int, len: Int) {}
  }

  companion object {
    internal fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input -> copyInto(input, digest) }
      return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun copyInto(input: InputStream, digest: MessageDigest) {
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) return
        digest.update(buffer, 0, n)
      }
    }
  }
}
