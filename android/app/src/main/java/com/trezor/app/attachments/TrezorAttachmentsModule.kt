package com.trezor.app.attachments

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.CreateDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import com.trezor.app.attachments.ModuleTasks.Lane.RENDERER
import com.trezor.app.attachments.ModuleTasks.Lane.WORKER
import com.trezor.app.vault.KeyVault
import com.trezor.app.vault.NativeTrezorAttachmentsSpec
import com.trezor.app.vault.VaultException
import java.io.File
import java.io.OutputStream
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
  // Throws when it can't tell whether files exist, so no key is created over unreadable files.
  private val keys = AttachmentKeys.of(vault) { store.hasAnyFile() }
  private val importer = AttachmentImporter(store)
  // Decrypted copies for display live only in the private cache, never in shared storage.
  private val views = AttachmentViews(store, File(reactContext.cacheDir, "attachments/view"))
  private val pdfs = PdfViews(views)
  private val export = AttachmentExport(store)
  // The FileProvider serves this directory only (res/xml/attachment_share_paths.xml).
  private val shares = ShareFiles(store, File(reactContext.cacheDir, ShareFiles.CACHE_DIR))
  private val cleanup = AttachmentCleanup(store, views, shares)
  /** Every task runs here: imports, deletes and cleanup on WORKER, PDF pages on RENDERER. */
  private val tasks = ModuleTasks()

  private class PendingPick(
      val promise: Promise,
      val imagesOnly: Boolean,
      val maxCount: Int,
      val parse: (resultCode: Int, data: Intent?) -> List<Uri>,
  )

  private class PendingExport(
      val promise: Promise,
      val id: String,
      val sizeBytes: Long,
      val sha256: String,
  )

  /** Main thread only. */
  private var pending: PendingPick? = null
  /** Main thread only. */
  private var pendingExport: PendingExport? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    // Idempotent: a second call must not touch the executors again. PDFs close after pages
    // still rendering; work already accepted still runs and settles its promise.
    if (!tasks.shutdown { pdfs.closeAll() }) return
    reactContext.removeActivityEventListener(this)
    super.invalidate()
  }

  /**
   * Runs [task] on [lane]. [promise] is rejected with IO_FAILED if the module has shut
   * down, or if the task throws anything (an OutOfMemoryError included) before settling it.
   */
  private fun submit(lane: ModuleTasks.Lane, promise: Promise, task: () -> Unit) =
      tasks.submit(lane, { code, message -> promise.reject(code, message) }, task)

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
        pending != null || pendingExport != null ->
            promise.reject("BUSY", "A picker is already open")
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
    if (requestCode == REQUEST_EXPORT) {
      onExportDestination(resultCode, data)
      return
    }
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
    submit(WORKER, pick.promise) { importAll(pick, uris) }
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
    // Always settles: per-file failures are outcomes, anything else rejects.
    try {
      val accepted = uris.take(pick.maxCount)
      val outcomes = importer.importAll(accepted.map { uri -> { sourceOf(uri) } }, pick.imagesOnly)
      pick.promise.resolve(resultJson(outcomes, uris.size - accepted.size))
    } catch (e: Exception) {
      pick.promise.reject("IO_FAILED", "Could not import files")
    }
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
    submit(WORKER, promise) {
      try {
        promise.resolve(list.count { store.delete(it!!) }.toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not delete attachment files")
      }
    }
  }

  override fun openView(id: String, sizeBytes: Double, sha256: String, promise: Promise) {
    submit(WORKER, promise) {
      try {
        promise.resolve(Uri.fromFile(views.open(id, sizeBytes.toLong(), sha256)).toString())
      } catch (e: AttachmentStore.StoreException) {
        promise.reject(viewErrorCode(e.code), "Attachment can't be shown")
      } catch (e: VaultException) {
        promise.reject("KEY_UNAVAILABLE", "Attachment key unavailable")
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Attachment can't be shown")
      }
    }
  }

  override fun closeView(uri: String, promise: Promise) {
    val path = Uri.parse(uri).path
    if (path == null) {
      promise.reject("INVALID_ARGUMENT", "Not a view file")
      return
    }
    submit(WORKER, promise) {
      try {
        views.close(path)
        promise.resolve(null)
      } catch (e: IllegalArgumentException) {
        promise.reject("INVALID_ARGUMENT", "Not a view file")
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not delete view file")
      }
    }
  }

  override fun openPdf(id: String, sizeBytes: Double, sha256: String, promise: Promise) {
    submit(WORKER, promise) {
      try {
        val opened = pdfs.open(id, sizeBytes.toLong(), sha256)
        val pages = JSONArray()
        opened.pageSizes.forEach { (w, h) -> pages.put(JSONArray().put(w).put(h)) }
        promise.resolve(JSONObject().put("handle", opened.handle).put("pages", pages).toString())
      } catch (e: PdfViews.PdfException) {
        promise.reject(e.code, "PDF can't be shown")
      } catch (e: AttachmentStore.StoreException) {
        promise.reject(viewErrorCode(e.code), "Attachment can't be shown")
      } catch (e: VaultException) {
        promise.reject("KEY_UNAVAILABLE", "Attachment key unavailable")
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Attachment can't be shown")
      }
    }
  }

  override fun renderPdfPage(handle: String, index: Double, widthPx: Double, promise: Promise) {
    submit(RENDERER, promise) {
      try {
        val page = pdfs.render(handle, index.toInt(), widthPx.toInt())
        promise.resolve(Uri.fromFile(page).toString())
      } catch (e: PdfViews.PdfException) {
        promise.reject(e.code, "Page can't be shown")
      } catch (e: IllegalArgumentException) {
        promise.reject("INVALID_ARGUMENT", "PDF is not open")
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Page can't be shown")
      }
    }
  }

  override fun closePdf(handle: String, promise: Promise) {
    // After any page still rendering, on the same thread.
    submit(RENDERER, promise) {
      pdfs.close(handle)
      promise.resolve(null)
    }
  }

  override fun purgeInactiveViews(promise: Promise) {
    submit(WORKER, promise) {
      try {
        promise.resolve(views.purgeInactive().toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not clean up view files")
      }
    }
  }

  /**
   * Save a copy: checks the attachment, then lets the user choose where to create a new
   * document (the system picker never replaces an existing file), then decrypts into it.
   */
  override fun saveCopy(
      id: String,
      sizeBytes: Double,
      sha256: String,
      fileName: String,
      mimeType: String,
      promise: Promise,
  ) {
    if (mimeType !in MediaTypes.ALL) {
      promise.reject("INVALID_ARGUMENT", "Unsupported type")
      return
    }
    submit(WORKER, promise) {
      try {
        export.verify(id, sizeBytes.toLong(), sha256)
      } catch (e: Exception) {
        rejectRead(promise, e)
        return@submit
      }
      UiThreadUtil.runOnUiThread {
        val activity = reactContext.currentActivity
        when {
          activity == null -> promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
          pending != null || pendingExport != null ->
              promise.reject("BUSY", "A picker is already open")
          else -> {
            val intent =
                CreateDocument(mimeType)
                    .createIntent(activity, AttachmentExport.destinationName(fileName, mimeType))
            pendingExport = PendingExport(promise, id, sizeBytes.toLong(), sha256)
            try {
              activity.startActivityForResult(intent, REQUEST_EXPORT)
            } catch (e: ActivityNotFoundException) {
              pendingExport = null
              promise.reject("PICKER_UNAVAILABLE", "No document picker available")
            }
          }
        }
      }
    }
  }

  private fun onExportDestination(resultCode: Int, data: Intent?) {
    val job = pendingExport ?: return
    pendingExport = null
    val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (uri == null) {
      job.promise.resolve("cancelled")
      return
    }
    submit(WORKER, job.promise) {
      try {
        export.write(job.id, job.sizeBytes, job.sha256, documentDestination(uri))
        job.promise.resolve("saved")
      } catch (e: AttachmentExport.ExportException) {
        job.promise.reject(e.code, "Could not save the copy")
      } catch (e: Exception) {
        job.promise.reject(AttachmentExport.EXPORT_FAILED, "Could not save the copy")
      }
    }
  }

  private fun documentDestination(uri: Uri) =
      object : AttachmentExport.Destination {
        override fun existingSize(): Long? =
            reactContext.contentResolver
                .query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

        override fun open(mode: String): OutputStream =
            reactContext.contentResolver.openOutputStream(uri, mode)
                ?: throw java.io.IOException("Destination can't be opened")

        override fun delete(): Boolean =
            DocumentsContract.deleteDocument(reactContext.contentResolver, uri)
      }

  /** Share: a checked copy in the share cache, offered through the system share sheet. */
  override fun share(
      id: String,
      sizeBytes: Double,
      sha256: String,
      fileName: String,
      mimeType: String,
      promise: Promise,
  ) {
    if (mimeType !in MediaTypes.ALL) {
      promise.reject("INVALID_ARGUMENT", "Unsupported type")
      return
    }
    submit(WORKER, promise) {
      val file =
          try {
            shares.prepare(id, sizeBytes.toLong(), sha256, fileName, mimeType)
          } catch (e: Exception) {
            rejectRead(promise, e)
            return@submit
          }
      UiThreadUtil.runOnUiThread {
        // A failure anywhere here deletes the copy at once (ShareFiles.launch); after a
        // successful launch it is kept for the retention period.
        try {
          shares.launch(
              file,
              uriFor = {
                FileProvider.getUriForFile(
                    reactContext, reactContext.packageName + ShareIntent.AUTHORITY_SUFFIX, it)
              },
              start = { uri ->
                val activity = reactContext.currentActivity ?: throw NoActivityException()
                val spec = ShareIntent.describe(uri.toString(), mimeType, file.name)
                activity.startActivity(ShareIntent.toChooser(spec, reactContext.contentResolver))
              },
          )
          promise.resolve(null)
        } catch (e: NoActivityException) {
          promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
        } catch (e: ActivityNotFoundException) {
          promise.reject("SHARE_UNAVAILABLE", "No app can receive this file")
        } catch (e: Exception) {
          promise.reject("IO_FAILED", "Could not share the file")
        }
      }
    }
  }

  override fun purgeExpiredShares(promise: Promise) {
    submit(WORKER, promise) {
      try {
        promise.resolve(shares.purgeExpired().toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not clean up shared files")
      }
    }
  }

  private class NoActivityException : Exception("No activity")

  /** Rejects for a failure reading the encrypted attachment. */
  private fun rejectRead(promise: Promise, e: Exception) {
    when (e) {
      is AttachmentStore.StoreException -> promise.reject(viewErrorCode(e.code), "Attachment can't be read")
      is VaultException -> promise.reject("KEY_UNAVAILABLE", "Attachment key unavailable")
      else -> promise.reject("IO_FAILED", "Attachment can't be read")
    }
  }

  override fun keepUnreferenced(promise: Promise) {
    submit(WORKER, promise) {
      try {
        promise.resolve(cleanup.beforeDatabaseCreated().toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not record existing attachment files")
      }
    }
  }

  override fun collectGarbage(knownIds: ReadableArray, promise: Promise) {
    val known = (0 until knownIds.size()).mapNotNull { knownIds.getString(it) }.toSet()
    submit(WORKER, promise) {
      try {
        // -1: already done in this process (a later React root), nothing was removed.
        promise.resolve((cleanup.atStartup(known) ?: -1).toDouble())
      } catch (e: Exception) {
        promise.reject("IO_FAILED", "Could not clean up attachment files")
      }
    }
  }

  private fun viewErrorCode(code: AttachmentStore.StoreException.Code): String =
      when (code) {
        AttachmentStore.StoreException.Code.MISSING -> "MISSING"
        AttachmentStore.StoreException.Code.CORRUPTED,
        AttachmentStore.StoreException.Code.UNSUPPORTED,
        AttachmentStore.StoreException.Code.KEY_MISMATCH,
        AttachmentStore.StoreException.Code.INTEGRITY_MISMATCH -> "DAMAGED"
        AttachmentStore.StoreException.Code.INVALID_ID -> "INVALID_ARGUMENT"
        else -> "IO_FAILED"
      }

  companion object {
    const val NAME = "TrezorAttachments"
    private const val SOURCE_PHOTOS = "photos"
    private const val SOURCE_FILES = "files"
    /** Mirrors MAX_DOCUMENT_ATTACHMENTS in src/data/attachments.ts. */
    private const val MAX_PICK = 10
    private const val REQUEST_PICK = 0x7a01
    private const val REQUEST_EXPORT = 0x7a02
  }
}
