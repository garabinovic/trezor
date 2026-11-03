package com.trezor.app.attachments

/**
 * The file types Trezor stores (mirrors ATTACHMENT_MIME_TYPES in src/data/attachments.ts).
 * The type is taken from the file's first bytes, never from its name or the type the
 * providing app declares, so a stored attachment is always what its record says.
 */
object MediaTypes {
  const val JPEG = "image/jpeg"
  const val PNG = "image/png"
  const val WEBP = "image/webp"
  const val HEIC = "image/heic"
  const val HEIF = "image/heif"
  const val PDF = "application/pdf"

  val IMAGES = listOf(JPEG, PNG, WEBP, HEIC, HEIF)
  val ALL = IMAGES + PDF

  /** Bytes [sniff] needs from the start of a file. */
  const val SNIFF_BYTES = 12

  private val HEIC_BRANDS = setOf("heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs")
  private val HEIF_BRANDS = setOf("mif1", "msf1", "heif")

  /** The type of a file starting with [header], or null if it is not a supported type. */
  fun sniff(header: ByteArray): String? {
    fun at(offset: Int, vararg bytes: Int) =
        header.size >= offset + bytes.size &&
            bytes.indices.all { header[offset + it] == bytes[it].toByte() }
    fun ascii(offset: Int, text: String) = at(offset, *text.map { it.code }.toIntArray())
    return when {
      at(0, 0xFF, 0xD8, 0xFF) -> JPEG
      at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) -> PNG
      ascii(0, "RIFF") && ascii(8, "WEBP") -> WEBP
      ascii(0, "%PDF-") -> PDF
      // ISO base media file: size(4) "ftyp" major-brand(4). AVIF and video brands are not ours.
      ascii(4, "ftyp") && header.size >= 12 -> {
        val brand = String(header, 8, 4, Charsets.US_ASCII)
        when (brand) {
          in HEIC_BRANDS -> HEIC
          in HEIF_BRANDS -> HEIF
          else -> null
        }
      }
      else -> null
    }
  }

  fun extensionOf(mimeType: String): String =
      when (mimeType) {
        JPEG -> "jpg"
        PNG -> "png"
        WEBP -> "webp"
        HEIC -> "heic"
        HEIF -> "heif"
        PDF -> "pdf"
        else -> "bin"
      }
}
