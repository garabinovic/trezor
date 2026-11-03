package com.trezor.app.attachments

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Encrypted attachment files under [root] (the app's no-backup directory in production).
 * SQLCipher holds the metadata and is the source of truth; this only stores bytes.
 *
 * - `<root>/<id>.tza`: one immutable file per attachment, named by its UUID. Nothing is
 *   ever rewritten in place; replacing an attachment means a new id.
 * - `<root>/tmp/<id>.part`: an import in progress. Written, synced and verified, then
 *   renamed into place (atomic within one directory), so `<id>.tza` is always complete.
 *
 * Crash safety relies on the caller's order: files are imported before their database row
 * is committed, and deleted only after the row is gone. A crash can therefore leave an
 * orphan file, never a row without a file; [collectGarbage] removes orphans at startup.
 *
 * [key] returns the 32-byte wrapping key (KeyVault "attachments"); it is zeroed after use.
 */
class AttachmentStore(private val root: File, private val key: () -> ByteArray) {

  class StoreException(val code: Code, message: String, cause: Throwable? = null) :
      Exception(message, cause) {
    enum class Code {
      INVALID_ID,
      ALREADY_EXISTS,
      MISSING,
      CORRUPTED,
      UNSUPPORTED,
      KEY_MISMATCH,
      TOO_LARGE,
      /** Expected size or SHA-256 (from the database) doesn't match the file. */
      INTEGRITY_MISMATCH,
      IO_FAILED,
    }
  }

  private val tmp = File(root, "tmp")

  private fun checkId(id: String): String {
    if (!ID_PATTERN.matches(id)) throw StoreException(StoreException.Code.INVALID_ID, "Invalid attachment id")
    return id
  }

  private fun fileOf(id: String) = File(root, "${checkId(id)}$SUFFIX")

  private inline fun <T> withKey(block: (ByteArray) -> T): T {
    val raw = key()
    try {
      return block(raw)
    } finally {
      raw.fill(0)
    }
  }

  private fun mapFormat(e: AttachmentFormat.FormatException): StoreException =
      StoreException(
          when (e.code) {
            AttachmentFormat.FormatException.Code.CORRUPTED -> StoreException.Code.CORRUPTED
            AttachmentFormat.FormatException.Code.UNSUPPORTED -> StoreException.Code.UNSUPPORTED
            AttachmentFormat.FormatException.Code.KEY_MISMATCH -> StoreException.Code.KEY_MISMATCH
            AttachmentFormat.FormatException.Code.TOO_LARGE -> StoreException.Code.TOO_LARGE
          },
          e.message ?: "Attachment format error",
          e,
      )

  fun exists(id: String): Boolean = fileOf(id).isFile

  /**
   * Encrypts [input] as attachment [id]. On success `<id>.tza` exists, has been read back
   * and verified, and the plaintext size and SHA-256 are returned. On any failure nothing
   * is left behind.
   */
  @Synchronized
  fun import(id: String, input: InputStream, maxBytes: Long): AttachmentFormat.Result {
    val target = fileOf(id)
    if (target.exists()) throw StoreException(StoreException.Code.ALREADY_EXISTS, "Attachment exists")
    if (!tmp.isDirectory && !tmp.mkdirs()) {
      throw StoreException(StoreException.Code.IO_FAILED, "Could not create attachment directory")
    }
    val part = File(tmp, "$id$PART_SUFFIX")
    try {
      val written =
          withKey { k ->
            FileOutputStream(part).use { out ->
              val buffered = out.buffered(BUFFER_BYTES)
              val result = AttachmentFormat.encrypt(input, buffered, id, k, maxBytes)
              buffered.flush()
              out.fd.sync()
              result
            }
          }
      val check =
          withKey { k ->
            FileInputStream(part).buffered(BUFFER_BYTES).use {
              AttachmentFormat.decrypt(it, NullOutputStream, id, k)
            }
          }
      if (check.sizeBytes != written.sizeBytes || check.sha256 != written.sha256) {
        throw StoreException(StoreException.Code.INTEGRITY_MISMATCH, "Attachment read-back mismatch")
      }
      if (!part.renameTo(target)) {
        throw StoreException(StoreException.Code.IO_FAILED, "Could not store attachment")
      }
      return written
    } catch (e: AttachmentFormat.FormatException) {
      throw mapFormat(e)
    } catch (e: StoreException) {
      throw e
    } catch (e: java.io.IOException) {
      throw StoreException(StoreException.Code.IO_FAILED, "Could not write attachment", e)
    } finally {
      part.delete()
    }
  }

  /**
   * Decrypts attachment [id] into [output]. With [expectedSize] / [expectedSha256] (from
   * the database) the result is also checked against them. On failure [output] may hold
   * a prefix of the plaintext, which the caller must discard.
   */
  fun decryptTo(
      id: String,
      output: OutputStream,
      expectedSize: Long? = null,
      expectedSha256: String? = null,
  ): AttachmentFormat.Result {
    val file = fileOf(id)
    if (!file.isFile) throw StoreException(StoreException.Code.MISSING, "Attachment file missing")
    val result =
        try {
          withKey { k ->
            FileInputStream(file).buffered(BUFFER_BYTES).use {
              AttachmentFormat.decrypt(it, output, id, k)
            }
          }
        } catch (e: AttachmentFormat.FormatException) {
          throw mapFormat(e)
        } catch (e: java.io.IOException) {
          throw StoreException(StoreException.Code.IO_FAILED, "Could not read attachment", e)
        }
    if ((expectedSize != null && expectedSize != result.sizeBytes) ||
        (expectedSha256 != null && expectedSha256 != result.sha256)) {
      throw StoreException(StoreException.Code.INTEGRITY_MISMATCH, "Attachment does not match its record")
    }
    return result
  }

  /** Decrypts to a sink only, to check the file. */
  fun verify(id: String, expectedSize: Long? = null, expectedSha256: String? = null) =
      decryptTo(id, NullOutputStream, expectedSize, expectedSha256)

  /** Deletes attachment [id]'s file, if any. Idempotent; returns whether a file was removed. */
  @Synchronized
  fun delete(id: String): Boolean = fileOf(id).let { it.isFile && it.delete() }

  /**
   * Removes files whose id is not in [knownIds] (the database's attachment ids) and every
   * unfinished import. Only safe when no import awaits its database row, i.e. at startup.
   * Files that are not attachment files are left alone. Returns the number removed.
   */
  @Synchronized
  fun collectGarbage(knownIds: Set<String>): Int {
    var removed = 0
    tmp.listFiles()?.forEach { if (it.isFile && it.name.endsWith(PART_SUFFIX) && it.delete()) removed++ }
    root.listFiles()?.forEach { file ->
      val id = file.name.removeSuffix(SUFFIX)
      if (file.isFile && file.name.endsWith(SUFFIX) && ID_PATTERN.matches(id) &&
          id !in knownIds && file.delete()) {
        removed++
      }
    }
    return removed
  }

  /**
   * Whether any encrypted attachment file exists. Never guesses "no": a store directory
   * that exists but can't be listed, or isn't a directory, throws IO_FAILED, so a caller
   * deciding whether a new key is safe fails closed (see AttachmentKeys).
   */
  fun hasAnyFile(): Boolean {
    if (!root.exists()) return false
    val files =
        (if (root.isDirectory) root.listFiles() else null)
            ?: throw StoreException(StoreException.Code.IO_FAILED, "Attachment directory can't be read")
    return files.any { it.isFile && it.name.endsWith(SUFFIX) }
  }

  /** Attachment ids that have a file (diagnostics and tests). */
  fun storedIds(): Set<String> =
      root.listFiles()
          ?.filter { it.isFile && it.name.endsWith(SUFFIX) }
          ?.map { it.name.removeSuffix(SUFFIX) }
          ?.filter(ID_PATTERN::matches)
          ?.toSet()
          ?: emptySet()

  private object NullOutputStream : OutputStream() {
    override fun write(b: Int) {}
    override fun write(b: ByteArray, off: Int, len: Int) {}
  }

  companion object {
    const val SUFFIX = ".tza"
    private const val PART_SUFFIX = ".part"
    private const val BUFFER_BYTES = 64 * 1024
    /** Lower-case UUID (the app's UUIDv7 ids); also keeps ids out of path traversal. */
    val ID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
  }
}
