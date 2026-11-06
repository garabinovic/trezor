package com.trezor.app.backup

import com.trezor.app.attachments.AttachmentFormat
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.security.MessageDigest
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/**
 * The file half of Check backup (spec v2.4 §7 steps 1–5), also the read-back after
 * creation (§6.2 step 7). Reads the file once, in order:
 * - header, Argon2id and BMK (by [TzbkReader]);
 * - the manifest, strictly parsed;
 * - the database section into [stagingDir]`/incoming.db`, still encrypted with the backup's
 *   SQLCipher key; its size and SHA-256 must equal the manifest's;
 * - every attachment section, decrypted and authenticated completely as a TZA file under the
 *   backup's wrap key, then discarded; size, SHA-256 and TZA header rules as in the manifest;
 * - the trailer and the end of the file.
 *
 * Nothing outside [stagingDir] is written: no live database, attachment, key or setting. On
 * any failure the staged file is deleted. Checking the staged database itself (SQLCipher,
 * schema, rows against the manifest) is the JS half.
 */
class BackupChecker(
    private val stagingDir: File,
    /** Called with the database size before it is staged (free-space rule, spec §9.6). */
    private val beforeStaging: (Long) -> Unit = {},
) {

  /** [sqlcipherKey] opens [incoming]; the caller zeroes it. */
  class Result(
      val backupId: String,
      val trailer: String,
      val manifest: BackupManifest,
      val incoming: File,
      val sqlcipherKey: ByteArray,
  )

  /** [open] creates the reader: from the password (Check) or the session's KEK (read-back). */
  fun check(input: InputStream, open: (InputStream) -> TzbkReader): Result {
    val incoming = File(stagingDir, INCOMING)
    try {
      open(input).use { reader ->
        val manifest = BackupManifest.decode(reader.readManifest())
        beforeStaging(manifest.database.sizeBytes)
        stageDatabase(reader, manifest, incoming)
        val wrapKey = reader.attachmentWrapKey()
        try {
          manifest.attachments.forEachIndexed { i, a -> verifyAttachment(reader, i, a, wrapKey) }
        } finally {
          wrapKey.fill(0)
        }
        reader.finish(manifest.attachments.size)
        return Result(hex(reader.header.backupId), hex(reader.trailer!!), manifest, incoming, reader.sqlcipherKey())
      }
    } catch (e: Throwable) {
      incoming.delete()
      throw e
    }
  }

  private fun stageDatabase(reader: TzbkReader, manifest: BackupManifest, incoming: File) {
    if (!stagingDir.isDirectory) throw java.io.IOException("Staging directory missing")
    if (incoming.exists()) throw java.io.IOException("Staged database already exists")
    val digest = MessageDigest.getInstance("SHA-256")
    val length =
        FileOutputStream(incoming).use { out ->
          val n = reader.readDatabase(DigestOutput(out, digest))
          out.fd.sync()
          n
        }
    if (length != manifest.database.sizeBytes || hex(digest.digest()) != manifest.database.sha256) {
      inconsistent("Database section doesn't match the manifest")
    }
  }

  /** Streams the section into the existing TZA decryptor on a second thread. */
  private fun verifyAttachment(reader: TzbkReader, ordinal: Int, a: BackupManifest.Attachment, wrapKey: ByteArray) {
    val pipeIn = PipedInputStream(PIPE_BYTES)
    val pipeOut = PipedOutputStream(pipeIn)
    val executor = Executors.newSingleThreadExecutor()
    try {
      val decrypted =
          executor.submit(
              Callable {
                pipeIn.use { input ->
                  val header = ByteArray(AttachmentFormat.HEADER_BYTES)
                  TzbkSections.readExactly(input, header, header.size) { corrupt("Attachment header truncated") }
                  TzaSection.checkHeader(header)
                  // decrypt reads to the end; SequenceInputStream then closes the pipe.
                  AttachmentFormat.decrypt(java.io.SequenceInputStream(header.inputStream(), input), Discard, a.id, wrapKey)
                }
              })
      try {
        pipeOut.use { reader.readAttachment(ordinal, a.tzaSizeBytes, it) }
      } catch (e: java.io.IOException) {
        // The decryptor stopped early (it failed); its error is reported below.
      }
      val result =
          try {
            decrypted.get()
          } catch (e: ExecutionException) {
            when (val cause = e.cause) {
              is BackupFormatException -> throw cause
              is AttachmentFormat.FormatException ->
                  throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, "Attachment $ordinal invalid", cause)
              else -> throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, "Attachment $ordinal invalid", cause)
            }
          }
      if (result.sizeBytes != a.sizeBytes || result.sha256 != a.sha256) inconsistent("Attachment $ordinal doesn't match the manifest")
    } finally {
      executor.shutdownNow()
    }
  }

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
    const val INCOMING = "incoming.db"
    private const val PIPE_BYTES = 64 * 1024

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
  }
}
