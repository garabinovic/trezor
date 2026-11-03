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

  /** Bytes [sniff] reads from the start of a file (enough for a typical `ftyp` box). */
  const val SNIFF_BYTES = 64

  private val HEIC_BRANDS = setOf("heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs")
  private val HEIF_BRANDS = setOf("mif1", "msf1", "heif")
  /** AVIF shares HEIF's container and `mif1`/`msf1` brands; it isn't supported. */
  private val AVIF_BRANDS = setOf("avif", "avis")

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
      // ISO base media file: size(4) "ftyp" major-brand(4) minor-version(4) then
      // compatible brands. Video brands, and AVIF in any position, are not ours.
      ascii(4, "ftyp") && header.size >= 12 -> {
        val brands = ftypBrands(header)
        val major = brands.first()
        when {
          brands.any { it in AVIF_BRANDS } -> null
          major in HEIC_BRANDS -> HEIC
          major in HEIF_BRANDS -> HEIF
          else -> null
        }
      }
      else -> null
    }
  }

  /** Major brand, then the compatible brands present in [header] (within the box). */
  private fun ftypBrands(header: ByteArray): List<String> {
    val boxSize =
        ((header[0].toInt() and 0xff) shl 24) or ((header[1].toInt() and 0xff) shl 16) or
            ((header[2].toInt() and 0xff) shl 8) or (header[3].toInt() and 0xff)
    // Size 0 means "to the end of the file"; 1 (64-bit size) has no brands where we look.
    val end = minOf(header.size, if (boxSize == 0) header.size else if (boxSize >= 16) boxSize else 12)
    val brands = mutableListOf(String(header, 8, 4, Charsets.US_ASCII))
    var offset = 16
    while (offset + 4 <= end) {
      brands.add(String(header, offset, 4, Charsets.US_ASCII))
      offset += 4
    }
    return brands
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
