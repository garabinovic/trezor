package com.trezor.app.attachments

import java.io.BufferedInputStream
import java.io.InputStream

/**
 * Turns one picked file into an encrypted attachment. Platform-free (the module adapts
 * content URIs to [Source]) so the rules are covered by JVM tests.
 *
 * Nothing about the file's content is logged; names are only returned to the caller.
 */
class AttachmentImporter(
    private val store: AttachmentStore,
    private val newId: () -> String = AttachmentIds::newId,
    private val maxBytes: Long = MAX_ATTACHMENT_BYTES,
) {

  class Source(
      /** Name reported by the providing app, if any. */
      val displayName: String?,
      /** Size reported by the providing app, if any. Only used to fail early. */
      val declaredSize: Long?,
      /** Opens the file; null or an exception means it cannot be read. */
      val open: () -> InputStream?,
  )

  sealed class Outcome {
    class Imported(
        val id: String,
        val fileName: String,
        val mimeType: String,
        val sizeBytes: Long,
        val sha256: String,
    ) : Outcome()

    class Failed(val fileName: String, val code: Code) : Outcome()
  }

  /** Per-file failures, part of the JS contract (src/attachments/platform.ts). */
  enum class Code {
    TOO_LARGE,
    UNSUPPORTED_TYPE,
    READ_FAILED,
    IMPORT_FAILED,
  }

  fun import(source: Source, imagesOnly: Boolean): Outcome {
    val reported = cleanName(source.displayName)
    fun failed(code: Code) = Outcome.Failed(reported.ifEmpty { "File" }, code)

    if (source.declaredSize != null && source.declaredSize > maxBytes) return failed(Code.TOO_LARGE)
    val raw =
        try {
          source.open()
        } catch (e: Exception) {
          null
        } ?: return failed(Code.READ_FAILED)

    BufferedInputStream(raw, BUFFER_BYTES).use { input ->
      val mimeType =
          try {
            input.mark(MediaTypes.SNIFF_BYTES)
            val header = input.readNBytesCompat(MediaTypes.SNIFF_BYTES)
            input.reset()
            MediaTypes.sniff(header)
          } catch (e: Exception) {
            return failed(Code.READ_FAILED)
          } ?: return failed(Code.UNSUPPORTED_TYPE)
      if (imagesOnly && mimeType !in MediaTypes.IMAGES) return failed(Code.UNSUPPORTED_TYPE)

      val id = newId()
      return try {
        val result = store.import(id, input, maxBytes)
        Outcome.Imported(id, fileName(reported, mimeType), mimeType, result.sizeBytes, result.sha256)
      } catch (e: AttachmentStore.StoreException) {
        failed(if (e.code == AttachmentStore.StoreException.Code.TOO_LARGE) Code.TOO_LARGE else Code.IMPORT_FAILED)
      } catch (e: Exception) {
        failed(Code.IMPORT_FAILED)
      }
    }
  }

  companion object {
    /** Mirrors MAX_ATTACHMENT_BYTES in src/data/attachments.ts. */
    const val MAX_ATTACHMENT_BYTES = 25L * 1024 * 1024
    const val MAX_NAME_CHARS = 120
    private const val MAX_EXTENSION_CHARS = 10
    private const val BUFFER_BYTES = 64 * 1024

    /** Bidirectional overrides and isolates, which can disguise a name's extension. */
    private fun isBidiControl(c: Char) = c in '‪'..'‮' || c in '⁦'..'⁩'

    /** The last path segment, without control characters; may be empty. */
    internal fun cleanName(raw: String?): String =
        raw.orEmpty()
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .filterNot { it.isISOControl() || isBidiControl(it) }
            .trim()
            .let { if (it.all { c -> c == '.' }) "" else it }

    /**
     * The name to keep for a file of [mimeType]: the provider's name, with an extension
     * added when it has none, shortened to [MAX_NAME_CHARS] keeping the extension.
     */
    internal fun fileName(cleaned: String, mimeType: String): String {
      val stem = cleaned.ifEmpty { if (mimeType == MediaTypes.PDF) "Document" else "Photo" }
      val dot = stem.lastIndexOf('.')
      val named =
          if (dot > 0 && dot < stem.length - 1) stem else "${stem.trimEnd('.')}.${MediaTypes.extensionOf(mimeType)}"
      if (named.length <= MAX_NAME_CHARS) return named
      val ext = named.substringAfterLast('.', "")
      val keep = if (ext.length in 1..MAX_EXTENSION_CHARS) ".$ext" else ""
      var head = named.substring(0, MAX_NAME_CHARS - keep.length)
      if (head.last().isHighSurrogate()) head = head.dropLast(1)
      return head + keep
    }

    private fun InputStream.readNBytesCompat(n: Int): ByteArray {
      val buffer = ByteArray(n)
      var filled = 0
      while (filled < n) {
        val read = read(buffer, filled, n - filled)
        if (read < 0) break
        filled += read
      }
      return buffer.copyOf(filled)
    }
  }
}
