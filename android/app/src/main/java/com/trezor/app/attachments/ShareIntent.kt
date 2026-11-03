package com.trezor.app.attachments

import android.content.ClipData
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri

/**
 * The share sheet request for one attachment. [describe] is platform-free so its rules
 * (action, type, read-only temporary grant) are covered by JVM tests; [toChooser] turns it
 * into the Android intents.
 */
object ShareIntent {

  data class Spec(
      val action: String,
      val mimeType: String,
      /** FileProvider content URI of the share file. */
      val streamUri: String,
      val fileName: String,
      /** Read-only and temporary: no write grant, no persistable grant. */
      val flags: Int,
  )

  const val AUTHORITY_SUFFIX = ".attachments"

  fun describe(streamUri: String, mimeType: String, fileName: String): Spec {
    require(mimeType in MediaTypes.ALL) { "Unsupported type" }
    require(streamUri.startsWith("content://")) { "Share files go through the FileProvider" }
    return Spec(ACTION_SEND, mimeType, streamUri, fileName, FLAG_GRANT_READ_URI_PERMISSION)
  }

  fun toChooser(spec: Spec, resolver: ContentResolver): Intent {
    val uri = Uri.parse(spec.streamUri)
    val send =
        Intent(spec.action)
            .setType(spec.mimeType)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(spec.flags)
    // The grant travels with ClipData, also through the chooser.
    send.clipData = ClipData.newUri(resolver, spec.fileName, uri)
    return Intent.createChooser(send, null).addFlags(spec.flags).also {
      it.clipData = send.clipData
    }
  }

  // Same values as Intent's constants, so describe() needs no Android classes.
  const val ACTION_SEND = "android.intent.action.SEND"
  const val FLAG_GRANT_READ_URI_PERMISSION = 0x00000001
}
