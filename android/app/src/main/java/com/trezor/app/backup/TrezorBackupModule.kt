package com.trezor.app.backup

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.result.contract.ActivityResultContracts.CreateDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenDocument
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.trezor.app.BuildConfig
import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.attachments.ModuleTasks
import com.trezor.app.attachments.ModuleTasks.Lane.WORKER
import com.trezor.app.vault.KeyVault
import com.trezor.app.vault.NativeTrezorBackupSpec
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import org.json.JSONArray
import org.json.JSONObject

/**
 * JS bridge for [BackupService]: the document pickers, Storage Access Framework streams and
 * JSON. All rules live in the JVM-tested classes of this package. Never logs a password,
 * key, file name or URI.
 */
class TrezorBackupModule(private val reactContext: ReactApplicationContext) :
    NativeTrezorBackupSpec(reactContext), ActivityEventListener {

  private val databaseDir = reactContext.getDatabasePath("placeholder.db").parentFile!!
  private val vault = KeyVault(File(reactContext.noBackupFilesDir, "keys"))
  private val attachmentsRoot = File(reactContext.noBackupFilesDir, "attachments")
  private val files = BackupFiles(databaseDir, reactContext.noBackupFilesDir, freeBytes = { StatFs(it.path).availableBytes })
  private val service =
      BackupService(
          files = files,
          attachmentsKey = { if (vault.hasKey(ATTACHMENTS_KEY)) vault.getKey(ATTACHMENTS_KEY) else null },
          fileOf = { File(attachmentsRoot, "$it${AttachmentStore.SUFFIX}") },
          app = BackupManifest.App("android", BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toLong()),
          liveDatabaseBytes = { File(databaseDir, "trezor.db").length() },
      )
  private val tasks = ModuleTasks()

  /** Main thread only. */
  private var pendingPick: Pair<Int, (Uri?) -> Unit>? = null
  @Volatile private var incompleteNotice: String = ""

  init {
    reactContext.addActivityEventListener(this)
    // Before any backup call (spec §6.4): staged exports and checks of an earlier process
    // go, and a partial destination it left is deleted where the provider allows it.
    tasks.submit(WORKER, { _, _ -> }) {
      val pending = files.cleanupAtStart() ?: return@submit
      val uri = Uri.parse(pending)
      val name = displayName(uri)
      val deleted = runCatching { DocumentsContract.deleteDocument(reactContext.contentResolver, uri) }.getOrDefault(false)
      if (!deleted && name != null) incompleteNotice = name
    }
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    tasks.shutdown { service.release() }
    reactContext.removeActivityEventListener(this)
    super.invalidate()
  }

  private fun submit(promise: Promise, task: () -> Unit) =
      tasks.submit(WORKER, { code, message -> promise.reject(code, message) }) {
        try {
          task()
        } catch (e: Exception) {
          reject(promise, e)
        }
      }

  override fun validatePassword(password: String, confirmation: String, promise: Promise) =
      submit(promise) {
        BackupPassword.encodeConfirmed(password, confirmation).fill(0)
        promise.resolve(null)
      }

  override fun beginBackup(password: String, confirmation: String, promise: Promise) =
      submit(promise) {
        val begun = service.begin(password, confirmation)
        try {
          promise.resolve(
              JSONObject()
                  .put("sessionId", begun.sessionId)
                  .put("location", begun.exportDir.absolutePath)
                  .put("exportName", begun.exportName)
                  .put("key", BackupService.hex(begun.sqlcipherKey))
                  .toString())
        } finally {
          begun.sqlcipherKey.fill(0)
        }
      }

  override fun pickDestination(sessionId: String, suggestedName: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = reactContext.currentActivity
      when {
        activity == null -> promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
        pendingPick != null -> promise.reject("BUSY", "A picker is already open")
        else ->
            launch(activity, REQUEST_DESTINATION, CreateDocument(MIME).createIntent(activity, suggestedName), promise) { uri ->
              if (uri == null) {
                promise.resolve("cancelled")
                return@launch
              }
              submit(promise) {
                service.setDestination(sessionId, destinationOf(uri), uri.toString())
                promise.resolve("picked")
              }
            }
      }
    }
  }

  override fun writeBackup(sessionId: String, rowsJson: String, promise: Promise) =
      submit(promise) { promise.resolve(service.write(sessionId, rows(rowsJson)).toDouble()) }

  override fun readBack(sessionId: String, promise: Promise) =
      submit(promise) { promise.resolve(staged(service.readBack(sessionId))) }

  override fun completeBackup(sessionId: String, promise: Promise) =
      submit(promise) {
        service.complete(sessionId)
        promise.resolve(null)
      }

  override fun abortBackup(sessionId: String, promise: Promise) = submit(promise) { promise.resolve(service.abort(sessionId)) }

  override fun pickBackupFile(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = reactContext.currentActivity
      when {
        activity == null -> promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
        pendingPick != null -> promise.reject("BUSY", "A picker is already open")
        else ->
            launch(activity, REQUEST_CHECK, OpenDocument().createIntent(activity, arrayOf("*/*")), promise) { uri ->
              promise.resolve(uri?.toString() ?: "")
            }
      }
    }
  }

  override fun checkBackup(uri: String, password: String, promise: Promise) =
      submit(promise) {
        val input =
            reactContext.contentResolver.openInputStream(Uri.parse(uri)) ?: throw IOException("Backup can't be opened")
        input.use { promise.resolve(staged(service.check(it, password))) }
      }

  override fun finishCheck(checkId: String, promise: Promise) =
      submit(promise) {
        service.finishCheck(checkId)
        promise.resolve(null)
      }

  override fun takeIncompleteNotice(promise: Promise) {
    promise.resolve(incompleteNotice)
    incompleteNotice = ""
  }

  override fun appVersion(): String =
      JSONObject().put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE).toString()

  // --- Pickers ---------------------------------------------------------------------------

  private fun launch(activity: Activity, request: Int, intent: Intent, promise: Promise, onResult: (Uri?) -> Unit) {
    pendingPick = request to onResult
    try {
      activity.startActivityForResult(intent, request)
    } catch (e: ActivityNotFoundException) {
      pendingPick = null
      promise.reject("PICKER_UNAVAILABLE", "No document picker available")
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    val (request, onResult) = pendingPick ?: return
    if (requestCode != request) return
    pendingPick = null
    onResult(if (resultCode == Activity.RESULT_OK) data?.data else null)
  }

  override fun onNewIntent(intent: Intent) {}

  // --- Storage Access Framework -----------------------------------------------------------

  private fun destinationOf(uri: Uri) =
      object : BackupService.Destination {
        override fun size(): Long? =
            reactContext.contentResolver
                .query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
                ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

        override fun openForWrite(): BackupService.Destination.Output {
          val resolver = reactContext.contentResolver
          val pfd =
              runCatching { resolver.openFileDescriptor(uri, "wt") }.getOrNull()
                  ?: resolver.openFileDescriptor(uri, "w")
                  ?: throw IOException("Destination can't be opened")
          val stream = FileOutputStream(pfd.fileDescriptor)
          return object : BackupService.Destination.Output {
            override val stream: OutputStream = stream

            override fun sync() = stream.fd.sync()

            override fun close() {
              stream.close()
              pfd.close()
            }
          }
        }

        override fun openForRead(): InputStream =
            reactContext.contentResolver.openInputStream(uri) ?: throw IOException("Backup can't be read back")

        override fun delete(): Boolean = DocumentsContract.deleteDocument(reactContext.contentResolver, uri)
      }

  private fun displayName(uri: Uri): String? =
      runCatching {
            reactContext.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null }
          }
          .getOrNull()

  // --- JSON ------------------------------------------------------------------------------

  private fun rows(json: String): List<BackupCreator.Row> {
    val array = JSONArray(json)
    return (0 until array.length()).map {
      val o = array.getJSONObject(it)
      BackupCreator.Row(
          id = o.getString("id"),
          itemId = o.getString("itemId"),
          fileName = o.getString("fileName"),
          mimeType = o.getString("mimeType"),
          sizeBytes = o.getLong("sizeBytes"),
          sha256 = o.getString("sha256"),
          formatVersion = o.getInt("formatVersion"),
      )
    }
  }

  private fun staged(s: BackupService.Staged): String {
    val r = s.result
    try {
      val attachments = JSONArray()
      for (a in r.manifest.attachments) {
        attachments.put(
            JSONObject()
                .put("id", a.id)
                .put("fileName", a.fileName)
                .put("mimeType", a.mimeType)
                .put("sizeBytes", a.sizeBytes)
                .put("sha256", a.sha256)
                .put("formatVersion", a.formatVersion))
      }
      return JSONObject()
          .put("checkId", s.checkId)
          .put("location", r.incoming.parentFile!!.absolutePath)
          .put("name", r.incoming.name)
          .put("key", BackupService.hex(r.sqlcipherKey))
          .put("backupId", r.backupId)
          .put("trailer", r.trailer)
          .put("schemaVersion", r.manifest.schemaVersion)
          .put("attachments", attachments)
          .toString()
    } finally {
      r.sqlcipherKey.fill(0)
    }
  }

  private fun reject(promise: Promise, e: Exception) {
    when (e) {
      is BackupPassword.PasswordException -> promise.reject(e.code.name, "Password not accepted")
      is BackupFormatException -> promise.reject(e.code.name, "Backup can't be used")
      is BackupCreator.AttachmentUnreadable ->
          promise.reject(
              ATTACHMENT_UNREADABLE,
              JSONObject().put("attachmentId", e.attachmentId).put("itemId", e.itemId).put("reason", e.reason.name).toString())
      is BackupFiles.InsufficientSpace ->
          promise.reject(INSUFFICIENT_SPACE, JSONObject().put("needed", e.needed).put("available", e.available).toString())
      is BackupService.DestinationException -> promise.reject(e.code, "Destination can't be used")
      is IllegalStateException -> promise.reject("INVALID_STATE", "No backup in progress")
      is IllegalArgumentException -> promise.reject("INVALID_ARGUMENT", "Invalid argument")
      else -> promise.reject("BACKUP_FAILED", "Backup failed")
    }
  }

  companion object {
    const val NAME = "TrezorBackup"
    const val ATTACHMENT_UNREADABLE = "BACKUP_ATTACHMENT_UNREADABLE"
    const val INSUFFICIENT_SPACE = "INSUFFICIENT_SPACE"
    private const val ATTACHMENTS_KEY = "attachments"
    private const val MIME = "application/octet-stream"
    private const val REQUEST_DESTINATION = 0x7b01
    private const val REQUEST_CHECK = 0x7b02
  }
}
