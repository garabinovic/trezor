package com.trezor.app.attachments

import java.io.OutputStream

/**
 * "Save a copy": decrypts an attachment straight into a destination the user chose
 * (a Storage Access Framework document), with no plaintext file in between. Only reads
 * the encrypted original, never changes it.
 *
 * The attachment is checked completely ([verify]) before the user is asked for a
 * destination, and checked again while writing; a write that fails part-way deletes the
 * destination where the provider allows it.
 */
class AttachmentExport(private val store: AttachmentStore) {

  /** Where the copy goes; platform-free so the rules are covered by JVM tests. */
  interface Destination {
    /** Size of what is already there, if the provider reports it. */
    fun existingSize(): Long?

    /** Opens for writing in [mode] (`"wt"` or `"w"`, as `ContentResolver` takes them). */
    fun open(mode: String): OutputStream

    /** Deletes the destination document; false if the provider doesn't allow it. */
    fun delete(): Boolean
  }

  class ExportException(val code: String, message: String, cause: Throwable? = null) :
      Exception(message, cause)

  /** Full check against the database record. Throws [AttachmentStore.StoreException]. */
  fun verify(id: String, expectedSize: Long, expectedSha256: String) {
    store.verify(id, expectedSize, expectedSha256)
  }

  /**
   * Writes the decrypted attachment to [destination], which must be shown to be empty:
   * one with content is refused, and so is one whose size the provider doesn't report
   * (it could be an existing file). Refused destinations are neither written nor deleted,
   * so an existing file is never overwritten or removed.
   *
   * The stream is opened with `"wt"` (write, truncate). Providers that don't accept that
   * mode get `"w"`; the destination is known to be empty, so nothing old can remain.
   */
  fun write(id: String, expectedSize: Long, expectedSha256: String, destination: Destination) {
    val existing =
        try {
          destination.existingSize()
        } catch (e: Exception) {
          null
        }
    if (existing == null) {
      throw ExportException(DESTINATION_UNVERIFIED, "Destination size unknown")
    }
    if (existing > 0) {
      throw ExportException(DESTINATION_NOT_EMPTY, "Destination already has content")
    }
    try {
      openTruncating(destination).use { out ->
        val buffered = out.buffered(BUFFER_BYTES)
        store.decryptTo(id, buffered, expectedSize, expectedSha256)
        buffered.flush()
      }
    } catch (e: Exception) {
      val removed =
          try {
            destination.delete()
          } catch (d: Exception) {
            false
          }
      throw ExportException(
          if (removed) EXPORT_FAILED else EXPORT_INCOMPLETE, "Could not save the copy", e)
    }
  }

  private fun openTruncating(destination: Destination): OutputStream =
      try {
        destination.open("wt")
      } catch (e: Exception) {
        destination.open("w")
      }

  companion object {
    const val DESTINATION_NOT_EMPTY = "DESTINATION_NOT_EMPTY"
    /** The provider doesn't report the destination's size; nothing was written. */
    const val DESTINATION_UNVERIFIED = "DESTINATION_UNVERIFIED"
    /** Failed; the partial destination was deleted. */
    const val EXPORT_FAILED = "EXPORT_FAILED"
    /** Failed, and the provider would not delete the partial destination. */
    const val EXPORT_INCOMPLETE = "EXPORT_INCOMPLETE"
    private const val BUFFER_BYTES = 64 * 1024
  }
}
