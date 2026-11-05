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
 *   renamed to `<root>/<id>.tza`. `tmp/` is a subdirectory on the same file system, so the
 *   rename is atomic (a reader sees no file or the complete file), and `<root>` is then
 *   synced so the new entry is durable before [import] returns. An import whose directory
 *   sync fails is undone and reported, never returned as stored.
 *
 * Crash safety relies on the caller's order: files are imported before their database row
 * is committed, and deleted only after the row is gone. A crash can leave an orphan file,
 * which [collectGarbage] removes at startup unless [keepUnreferenced] recorded it. A row
 * without its file would need storage that loses a synced directory entry; the store
 * can't recreate such a file (it shows as missing).
 *
 * [key] returns the 32-byte wrapping key (KeyVault "attachments"); it is zeroed after use.
 */
class AttachmentStore(
    private val root: File,
    /** Makes [root]'s entries durable after a rename; replaceable in tests. */
    private val syncDirectory: (File) -> Unit = DirectorySync::sync,
    private val key: () -> ByteArray,
) {

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
      // The rename adds `<id>.tza` to root; sync root so that entry survives a power loss
      // before the caller commits the row that refers to it. tmp/ isn't synced: a stale
      // `.part` entry reappearing after a crash is removed by collectGarbage.
      try {
        syncDirectory(root)
      } catch (e: Exception) {
        // Not known to be durable: don't let a row refer to it.
        target.delete()
        throw StoreException(StoreException.Code.IO_FAILED, "Could not make attachment durable", e)
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
   * unfinished import. Only safe when no import awaits its database row, i.e. once at
   * startup (AttachmentCleanup). Files recorded by [keepUnreferenced] and files that are
   * not attachment files are left alone. If that record can't be read, nothing but
   * unfinished imports is removed and IO_FAILED is thrown. Returns the number removed.
   */
  @Synchronized
  fun collectGarbage(knownIds: Set<String>): Int {
    var removed = 0
    tmp.listFiles()?.forEach { if (it.isFile && it.name.endsWith(PART_SUFFIX) && it.delete()) removed++ }
    val kept = keptIds()
    root.listFiles()?.forEach { file ->
      val id = file.name.removeSuffix(SUFFIX)
      if (file.isFile && file.name.endsWith(SUFFIX) && ID_PATTERN.matches(id) &&
          id !in knownIds && id !in kept && file.delete()) {
        removed++
      }
    }
    return removed
  }

  /**
   * Records every stored id not in [knownIds] as kept, so [collectGarbage] never removes
   * those files (used when the database had to be created while files exist: they may be
   * all that is left of the missing original). The record is added to, never shrunk, and
   * written durably (synced, renamed, directory synced) before this returns. It holds ids
   * only. Fails closed like [hasAnyFile]: a store directory that exists but can't be listed
   * throws IO_FAILED instead of keeping nothing. Returns how many ids are kept in total.
   */
  @Synchronized
  fun keepUnreferenced(knownIds: Set<String>): Int {
    val before = keptIds()
    val stored =
        listOrThrow()
            .filter { it.isFile && it.name.endsWith(SUFFIX) }
            .map { it.name.removeSuffix(SUFFIX) }
            .filter(ID_PATTERN::matches)
    val kept = before + (stored.toSet() - knownIds)
    if (kept == before) return kept.size
    if (!tmp.isDirectory && !tmp.mkdirs()) {
      throw StoreException(StoreException.Code.IO_FAILED, "Could not create attachment directory")
    }
    val part = File(tmp, "$KEPT_NAME.new")
    try {
      FileOutputStream(part).use { out ->
        val text = (listOf(KEPT_HEADER) + kept.sorted()).joinToString("\n", postfix = "\n")
        out.write(text.toByteArray(Charsets.US_ASCII))
        out.fd.sync()
      }
      if (!part.renameTo(File(root, KEPT_NAME))) {
        throw StoreException(StoreException.Code.IO_FAILED, "Could not record kept attachments")
      }
      syncDirectory(root)
    } catch (e: java.io.IOException) {
      throw StoreException(StoreException.Code.IO_FAILED, "Could not record kept attachments", e)
    } finally {
      part.delete()
    }
    return kept.size
  }

  /** Ids recorded by [keepUnreferenced]; throws IO_FAILED when the record can't be read. */
  fun keptIds(): Set<String> {
    val file = File(root, KEPT_NAME)
    if (!file.exists()) return emptySet()
    val lines =
        try {
          file.readText(Charsets.US_ASCII).split("\n").dropLastWhile { it.isEmpty() }
        } catch (e: java.io.IOException) {
          throw StoreException(StoreException.Code.IO_FAILED, "Kept attachments can't be read", e)
        }
    if (lines.firstOrNull() != KEPT_HEADER || !lines.drop(1).all(ID_PATTERN::matches)) {
      throw StoreException(StoreException.Code.IO_FAILED, "Kept attachments record is damaged")
    }
    return lines.drop(1).toSet()
  }

  /**
   * Whether any encrypted attachment file exists. Never guesses "no": a store directory
   * that exists but can't be listed, or isn't a directory, throws IO_FAILED, so a caller
   * deciding whether a new key is safe fails closed (see AttachmentKeys).
   */
  fun hasAnyFile(): Boolean = listOrThrow().any { it.isFile && it.name.endsWith(SUFFIX) }

  /** Entries of [root]; none if it doesn't exist, IO_FAILED if it exists but can't be listed. */
  private fun listOrThrow(): Array<File> {
    if (!root.exists()) return emptyArray()
    return (if (root.isDirectory) root.listFiles() else null)
        ?: throw StoreException(StoreException.Code.IO_FAILED, "Attachment directory can't be read")
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
    /** In [root], next to the `.tza` files; not an attachment file name. */
    const val KEPT_NAME = "kept-ids"
    private const val KEPT_HEADER = "trezor.kept-attachments|1"
    private const val BUFFER_BYTES = 64 * 1024
    /** Lower-case UUID (the app's UUIDv7 ids); also keeps ids out of path traversal. */
    val ID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
  }
}
