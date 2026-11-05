package com.trezor.app.attachments

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Open PDF attachments, rendered page by page with Android's [PdfRenderer] (no external
 * viewer, nothing leaves the app). [PdfRenderer] needs a seekable file, so the PDF is a
 * checked, decrypted copy from [AttachmentViews] while it is open; rendered pages are
 * view files too. [close] deletes all of them.
 */
class PdfViews(private val views: AttachmentViews) {

  class PdfException(val code: String, message: String, cause: Throwable? = null) :
      Exception(message, cause)

  class Opened(val handle: String, val pageSizes: List<Pair<Int, Int>>)

  private class Document(
      val file: File,
      val descriptor: ParcelFileDescriptor,
      val renderer: PdfRenderer,
  ) {
    val pages = mutableSetOf<String>()
    var closed = false
  }

  private val random = SecureRandom()
  private val documents = ConcurrentHashMap<String, Document>()

  /** Throws [AttachmentStore.StoreException] or [PdfException]. */
  fun open(id: String, expectedSize: Long, expectedSha256: String): Opened {
    val file = views.open(id, expectedSize, expectedSha256)
    var descriptor: ParcelFileDescriptor? = null
    try {
      descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
      val renderer =
          try {
            PdfRenderer(descriptor)
          } catch (e: SecurityException) {
            throw PdfException(PROTECTED, "PDF is password-protected", e)
          } catch (e: Exception) {
            throw PdfException(UNSUPPORTED, "PDF can't be read", e)
          }
      val sizes =
          try {
            if (renderer.pageCount < 1) throw IllegalStateException("No pages")
            (0 until renderer.pageCount).map { index ->
              renderer.openPage(index).use { it.width to it.height }
            }
          } catch (e: Throwable) {
            renderer.close()
            if (e is Exception) throw PdfException(UNSUPPORTED, "PDF can't be read", e)
            throw e
          }
      val handle = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
      documents[handle] = Document(file, descriptor, renderer)
      return Opened(handle, sizes)
    } catch (e: Throwable) {
      // Errors too (out of memory): the descriptor and the decrypted copy never outlive a
      // failed open.
      descriptor?.close()
      views.close(file.path)
      throw e
    }
  }

  /** Renders page [index] at [widthPx] into a new view file (PNG on white). */
  fun render(handle: String, index: Int, widthPx: Int): File {
    val document = documents[handle] ?: throw IllegalArgumentException("PDF is not open")
    synchronized(document) {
      if (document.closed) throw IllegalArgumentException("PDF is not open")
      require(index in 0 until document.renderer.pageCount) { "No such page" }
      val out = views.newFile()
      try {
        document.renderer.openPage(index).use { page ->
          var width = widthPx.coerceIn(1, MAX_WIDTH_PX)
          var height = maxOf(1, (width.toDouble() * page.height / page.width).roundToInt())
          // Very tall pages: keep the bitmap within a fixed memory budget.
          val pixels = width.toLong() * height
          if (pixels > MAX_PIXELS) {
            val scale = sqrt(MAX_PIXELS.toDouble() / pixels)
            width = maxOf(1, (width * scale).toInt())
            height = maxOf(1, (height * scale).toInt())
          }
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          try {
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            FileOutputStream(out).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
          } finally {
            bitmap.recycle()
          }
        }
        document.pages.add(out.path)
        return out
      } catch (e: Throwable) {
        // Errors too (a page bitmap that doesn't fit in memory): no partial page file stays.
        views.close(out.path)
        if (e is Exception) throw PdfException(UNSUPPORTED, "Page can't be shown", e)
        throw e
      }
    }
  }

  /** Closes the PDF and deletes its copy and every page rendered from it. */
  fun close(handle: String) {
    val document = documents.remove(handle) ?: return
    synchronized(document) {
      document.closed = true
      runCatching { document.renderer.close() }
      runCatching { document.descriptor.close() }
      runCatching { views.close(document.file.path) }
      document.pages.forEach { runCatching { views.close(it) } }
    }
  }

  fun closeAll() = documents.keys.toList().forEach(::close)

  companion object {
    const val PROTECTED = "PDF_PROTECTED"
    const val UNSUPPORTED = "PDF_UNSUPPORTED"
    private const val MAX_WIDTH_PX = 2048
    /** ~16 MB as ARGB_8888. */
    private const val MAX_PIXELS = 4_000_000L
  }
}
