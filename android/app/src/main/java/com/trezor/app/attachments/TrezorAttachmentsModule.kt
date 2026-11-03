package com.trezor.app.attachments

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.OpenDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import com.trezor.app.vault.KeyVault
import com.trezor.app.vault.NativeTrezorAttachmentsSpec
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * JS bridge for encrypted attachments. File bytes never pass through JavaScript: a picked
 * file is read from its content URI and encrypted straight into the store, and JS only
 * receives its metadata. No storage permission is needed: the Photo Picker and the system
 * document picker grant read access to the chosen files only, and nothing is kept of the
 * original URI afterwards.
 *
 * Never logs file names or content.
 */
class TrezorAttachmentsModule(private val reactContext: ReactApplicationContext) :
    NativeTrezorAttachmentsSpec(reactContext), ActivityEventListener {

  // noBackupFilesDir is excluded from Auto Backup and device-to-device transfer.
  private val vault = KeyVault(File(reactContext.noBackupFilesDir, "keys"))
  private val store: AttachmentStore =
      AttachmentStore(File(reactContext.noBackupFilesDir, "attachments")) { keys.obtain() }
  private val keys =
      AttachmentKeys(
          hasKey = { vault.hasKey(AttachmentKeys.KEY_ID) },
          getKey = { vault.getKey(AttachmentKeys.KEY_ID) },
          createKey = { vault.createKey(AttachmentKeys.KEY_ID) },
          hasFiles = { store.storedIds().isNotEmpty() },
      )
  private val importer = AttachmentImporter(store)
  /** One worker: imports, deletes and garbage collection never overlap. */
  private val worker: ExecutorService = Executors.newSingleThreadExecutor()

  private class PendingPick(
      val promise: Promise,
      val imagesOnly: Boolean,
      val maxCount: Int,
      val parse: (resultCode: Int, data: Intent?) -> List<Uri>,
  )

  /** Main thread only. */
  private var pending: PendingPick? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    reactContext.removeActivityEventListener(this)
    worker.shutdown()
    super.invalidate()
  }

  override fun pick(source: String, imagesOnly: Boolean, maxCount: Double, promise: Promise) {
    val max = maxCount.toInt()
    if ((source != SOURCE_PHOTOS && source != SOURCE_FILES) || max !in 1..MAX_PICK ||
        (source == SOURCE_PHOTOS && !imagesOnly)) {
      promise.reject("INVALID_ARGUMENT", "Invalid pick request")
      return
    }
    UiThreadUtil.runOnUiThread {
      val activity = reactContext.currentActivity
      when {
        activity == null -> promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
        pending != null -> promise.reject("BUSY", "A picker is already open")
        else -> launch(activity, source, imagesOnly, max, promise)
      }
    }
  }

  private fun launch(
      activity: Activity,
      source: String,
      imagesOnly: Boolean,
      max: Int,
      promise: Promise,
  ) {
    val intent: Intent
    val parse: (Int, Intent?) -> List<Uri>
    if (source == SOURCE_PHOTOS) {
      val request = PickVisualMediaRequest(PickVisualMedia.ImageOnly)
      val limit =
          if (PickVisualMedia.isPhotoPickerAvailable()) minOf(max, MediaStore.getPickImagesMaxLimit())
          else max
      if (limit > 1) {
        val contract = PickMultipleVisualMedia(limit)
        intent = contract.createIntent(activity, request)
        parse = contract::parseResult
      } else {
        val contract = PickVisualMedia()
        intent = contract.createIntent(activity, request)
        parse = { code, data -> listOfNotNull(contract.parseResult(code, data)) }
      }
    } else {
      val types = (if (imagesOnly) MediaTypes.IMAGES else MediaTypes.ALL).toTypedArray()
      if (max > 1) {
        val contract = OpenMultipleDocuments()
        intent = contract.createIntent(activity, types)
        parse = contract::parseResult
      } else {
        val contract = OpenDocument()
        intent = contract.createIntent(activity, types)
        parse = { code, data -> listOfNotNull(contract.parseResult(code, data)) }
      }
    }
    pending = PendingPick(promise, imagesOnly, max, parse)
    try {
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: ActivityNotFoundException) {
      pending = null
      promise.reject("PICKER_UNAVAILABLE", "No picker available")
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_PICK) return
    // Absent when the app process was restarted while the picker was open: nothing waits
    // for the result, so nothing is imported.
    val pick = pending ?: return
    pending = null
    val uris =
        try {
          pick.parse(resultCode, data).distinct()
        } catch (e: Exception) {
          emptyList()
        }
    if (uris.isEmpty()) {
      pick.promise.resolve(resultJson(emptyList(), 0))
      return
    }
    worker.execute { importAll(pick, uris) }
  }

  override fun onNewIntent(intent: Intent) {}

  private fun importAll(pick: PendingPick, uris: List<Uri>) {
    // Fail the whole pick, before reading anything, if the key can't be had.
    try {
      keys.obtain().fill(0)
    } catch (e: Exception) {
      pick.promise.reject("KEY_UNAVAILABLE", "Attachment key unavailable")
      return
    }
    val accepted = uris.take(pick.maxCount)
    val outcomes = accepted.map { importer.import(sourceOf(it), pick.imagesOnly) }
    pick.promise.resolve(resultJson(outcomes, uris.size - accepted.size))
  }

  private fun sourceOf(uri: Uri): AttachmentImporter.Source {
    var name: String? = null
    var size: Long? = null
    try {
      reactContext.contentResolver
          .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
          ?.use { cursor ->
            if (cursor.moveToFirst()) {
              val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
              val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
              if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)
              if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
            }
          }
    } catch (e: Exception) {
      // Name and size are optional; opening the file decides whether it can be read.
    }
    return AttachmentImporter.Source(name, size) { reactContext.contentResolver.openInputStream(uri) }
  }

  private fun resultJson(outcomes: List<AttachmentImporter.Outcome>, skipped: Int): String {
    val imported = JSONArray()
    val failed = JSONArray()
    for (outcome in outcomes) {
      when (outcome) {
        is AttachmentImporter.Outcome.Imported ->
            imported.put(
                JSONObject()
                    .put("id", outcome.id)
                    .put("fileName", outcome.fileName)
                    .put("mimeType", outcome.mimeType)
                    .put("sizeBytes", outcome.sizeBytes)
                    .put("sha256", outcome.sha256)
                    .put("formatVersion", AttachmentFormat.VERSION))
        is AttachmentImporter.Outcome.Failed ->
            failed.put(JSONObject().put("fileName", outcome.fileName).put("code", outcome.code.name))
      }
    }
    return JSONObject()
        .put("imported", imported)
        .put("failed", failed)
        .put("skipped", skipped)
        .toString()
  }

  override fun deleteFiles(ids: ReadableArray, promise: Promise) {
    val list = (0 until ids.size()).map { ids.getString(it) }
    if (list.any { it == null || !AttachmentStore.ID_PATTERN.matches(it) }) {
      promise.reject("INVALID_ARGUMENT", "Invalid attachment id")
      return
    }
    worker.execute {
      try {
        promise.resolve(list.count { store.delete(it!!) }.toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not delete attachment files")
      }
    }
  }

  override fun collectGarbage(knownIds: ReadableArray, promise: Promise) {
    val known = (0 until knownIds.size()).mapNotNull { knownIds.getString(it) }.toSet()
    worker.execute {
      try {
        promise.resolve(store.collectGarbage(known).toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not clean up attachment files")
      }
    }
  }

  companion object {
    const val NAME = "TrezorAttachments"
    private const val SOURCE_PHOTOS = "photos"
    private const val SOURCE_FILES = "files"
    /** Mirrors MAX_DOCUMENT_ATTACHMENTS in src/data/attachments.ts. */
    private const val MAX_PICK = 10
    private const val REQUEST_PICK = 0x7a01
  }
}
