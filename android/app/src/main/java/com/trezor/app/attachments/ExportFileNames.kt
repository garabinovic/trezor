package com.trezor.app.attachments

/**
 * The file name a decrypted copy gets outside the store: the share-cache file (Share) and
 * the name suggested to the save-to picker (Save a copy). The stored display name in the
 * database is never changed; this only derives a name that the file system accepts.
 *
 * Android's file systems (ext4, f2fs, FAT/exFAT via FUSE) limit one name to 255 *bytes*,
 * and a UTF-8 character can take up to 4, so the stored 120-character limit isn't enough:
 * 120 CJK characters are about 360 bytes. Names are therefore limited to [MAX_BYTES] UTF-8
 * bytes, which leaves 55 bytes for what document providers append to avoid a clash
 * (" (1)", " (12)") and for encodings that need more bytes than UTF-8.
 */
object ExportFileNames {
  /** 255-byte name limit minus a 55-byte safety margin. */
  const val MAX_BYTES = 200
  /** An extension longer than this (in bytes, dot included) isn't kept when shortening. */
  const val MAX_EXTENSION_BYTES = 16

  /**
   * [raw] cleaned as on import (last path segment, no control or bidi characters), given
   * an extension for [mimeType] if it has none, then shortened to [MAX_BYTES] UTF-8 bytes.
   *
   * Shortening keeps the extension and cuts the part before it at a code-point boundary,
   * so the result is always valid UTF-8. If the extension itself is longer than
   * [MAX_EXTENSION_BYTES], it is replaced by the type's own extension (`.pdf`, `.jpg`, …),
   * so the result is deterministic and still opens with the right app.
   */
  fun forExport(raw: String, mimeType: String): String {
    val cleaned = withoutLoneSurrogates(AttachmentImporter.cleanName(raw))
    return limit(AttachmentImporter.fileName(cleaned, mimeType), mimeType)
  }

  /** Half of a UTF-16 pair can't be encoded as UTF-8; such a char is dropped. */
  private fun withoutLoneSurrogates(text: String): String {
    val out = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
      val codePoint = text.codePointAt(i)
      val count = Character.charCount(codePoint)
      if (!(count == 1 && Character.isSurrogate(text[i]))) out.appendCodePoint(codePoint)
      i += count
    }
    return out.toString()
  }

  internal fun limit(name: String, mimeType: String): String {
    if (utf8Length(name) <= MAX_BYTES) return name
    val dot = name.lastIndexOf('.')
    val hasExtension = dot > 0 && dot < name.length - 1
    val stem = if (hasExtension) name.substring(0, dot) else name
    val extension =
        when {
          !hasExtension -> ""
          utf8Length(name.substring(dot)) <= MAX_EXTENSION_BYTES -> name.substring(dot)
          else -> ".${MediaTypes.extensionOf(mimeType)}"
        }
    val head = truncate(stem, MAX_BYTES - utf8Length(extension)).trimEnd(' ', '.')
    val safeHead = head.ifEmpty { if (mimeType == MediaTypes.PDF) "Document" else "Photo" }
    return safeHead + extension
  }

  fun utf8Length(text: String): Int = text.toByteArray(Charsets.UTF_8).size

  /** The longest prefix of [text] within [maxBytes] UTF-8 bytes, ending on a code point. */
  private fun truncate(text: String, maxBytes: Int): String {
    var bytes = 0
    var end = 0
    while (end < text.length) {
      val codePoint = text.codePointAt(end)
      val size =
          when {
            codePoint < 0x80 -> 1
            codePoint < 0x800 -> 2
            codePoint < 0x10000 -> 3
            else -> 4
          }
      if (bytes + size > maxBytes) break
      bytes += size
      end += Character.charCount(codePoint)
    }
    return text.substring(0, end)
  }
}
