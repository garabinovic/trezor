package com.trezor.app.restore

import android.net.Uri
import android.os.StatFs
import android.system.Os
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.trezor.app.attachments.AttachmentKeys
import com.trezor.app.attachments.AttachmentLocations
import com.trezor.app.attachments.ModuleTasks
import com.trezor.app.attachments.ModuleTasks.Lane.WORKER
import com.trezor.app.attachments.RestoreGate
import com.trezor.app.backup.BackupFiles
import com.trezor.app.backup.BackupFormatException
import com.trezor.app.backup.BackupPassword
import com.trezor.app.reminders.ReminderScheduler
import com.trezor.app.vault.KeyVault
import com.trezor.app.vault.NativeTrezorRestoreSpec
import com.trezor.app.vault.VaultException
import java.io.File
import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

/**
 * JS bridge for [RestoreService]: the document stream, Android services and JSON. The rules
 * live in the JVM-tested classes of this package. Never logs a password, key, id, name or URI.
 */
class TrezorRestoreModule(private val reactContext: ReactApplicationContext) : NativeTrezorRestoreSpec(reactContext) {

  private val databaseDir = reactContext.getDatabasePath("placeholder.db").parentFile!!
  private val noBackupDir = reactContext.noBackupFilesDir
  private val layout = RestoreLayout(databaseDir, noBackupDir)
  private val ops = RestoreFileOps(layout)
  private val vault = KeyVault(File(noBackupDir, "keys"))
  private val attachmentKeys = AttachmentKeys.of(vault) { AttachmentLocations.hasAnyFile(noBackupDir) }
  private val service =
      RestoreService(
          layout = layout,
          ops = ops,
          attachmentsKey = { attachmentKeys.obtain() },
          freeBytes = { StatFs(it.path).availableBytes },
          deviceOf = { Os.stat(it.path).st_dev },
      )
  private val schedule = ReminderScheduler.restoreOps(reactContext, layout.schedule, layout.savedSchedule, ops::syncDirectory)
  private val tasks = ModuleTasks()

  override fun getName(): String = NAME

  override fun invalidate() {
    // The coordinator is gone with this instance: attachment work must not stay refused.
    // A journal (if any) stays for recovery (Step 4).
    tasks.shutdown {
      service.release()
      RestoreGate.end()
    }
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

  override fun preflight(fromErrorScreen: Boolean, promise: Promise) =
      submit(promise) {
        val result =
            service.preflight(
                fromErrorScreen,
                databaseKeyUsable = {
                  runCatching { vault.getKey(DATABASE_KEY).fill(0) }.isSuccess
                },
                attachmentsKey = {
                  if (!vault.hasKey(AttachmentKeys.KEY_ID)) null
                  else runCatching { vault.getKey(AttachmentKeys.KEY_ID).fill(0) }.isSuccess
                },
            )
        val json =
            when (result) {
              RestoreService.Preflight.Ready -> JSONObject().put("status", "ready")
              RestoreService.Preflight.NotOffered -> JSONObject().put("status", "notOffered")
              is RestoreService.Preflight.Refused -> JSONObject().put("status", "refused").put("code", result.code)
            }
        promise.resolve(json.toString())
      }

  override fun beginRestore(uri: String, password: String, promise: Promise) =
      submit(promise) {
        val input = reactContext.contentResolver.openInputStream(Uri.parse(uri)) ?: throw IOException("Backup can't be opened")
        val begun = service.begin(input, password)
        promise.resolve(
            JSONObject()
                .put("sessionId", begun.sessionId)
                .put("backupId", begun.backupId)
                .put("attachments", begun.attachments)
                .put("databaseBytes", begun.databaseBytes)
                .toString())
      }

  override fun acquireGate(promise: Promise) =
      submit(promise) {
        RestoreGate.begin()
        try {
          RestoreGate.requireHooks().drain()
        } catch (e: Exception) {
          RestoreGate.end()
          throw e
        }
        promise.resolve(null)
      }

  override fun activeShareCount(promise: Promise) =
      submit(promise) { promise.resolve(RestoreGate.requireHooks().activeShares().toDouble()) }

  override fun stageRestore(sessionId: String, expectedBackupId: String, expectedTrailer: String, promise: Promise) =
      submit(promise) {
        check(RestoreGate.isHeld()) { "Restore gate not held" }
        val staged = service.stage(sessionId, expectedBackupId.ifEmpty { null }, expectedTrailer.ifEmpty { null })
        try {
          val attachments = JSONArray()
          for (a in staged.manifest.attachments) {
            attachments.put(
                JSONObject()
                    .put("id", a.id)
                    .put("fileName", a.fileName)
                    .put("mimeType", a.mimeType)
                    .put("sizeBytes", a.sizeBytes)
                    .put("sha256", a.sha256)
                    .put("formatVersion", a.formatVersion))
          }
          promise.resolve(
              JSONObject()
                  .put("restoreId", staged.restoreId)
                  .put("backupId", staged.backupId)
                  .put("trailer", staged.trailer)
                  .put("location", layout.restoreDbDir.absolutePath)
                  .put("incoming", layout.incoming.name)
                  .put("staged", layout.stagedDb.name)
                  .put("key", RestoreService.hex(staged.sqlcipherKey))
                  .put("schemaVersion", staged.manifest.schemaVersion)
                  .put("attachments", attachments)
                  .toString())
        } finally {
          staged.sqlcipherKey.fill(0)
        }
      }

  override fun deleteIncoming(sessionId: String, promise: Promise) =
      submit(promise) {
        service.deleteIncoming(sessionId)
        promise.resolve(null)
      }

  override fun preserveRetained(sessionId: String, promise: Promise) =
      submit(promise) {
        val o = service.preserveRetained(sessionId)
        promise.resolve(
            JSONObject()
                .put("linked", o.linked)
                .put("copied", o.copied)
                .put("missing", o.missing)
                .put("failClosed", o.failClosed)
                .toString())
      }

  override fun saveAndClearSchedule(sessionId: String, promise: Promise) =
      submit(promise) { promise.resolve(service.saveAndClearSchedule(sessionId, schedule).json) }

  override fun purgeCaches(promise: Promise) =
      submit(promise) {
        if (!RestoreGate.requireHooks().purgeCaches()) throw IOException("Decrypted caches not empty")
        promise.resolve(null)
      }

  override fun abortRestore(sessionId: String, promise: Promise) =
      submit(promise) {
        service.abort(sessionId, schedule)
        promise.resolve(null)
      }

  override fun releaseGate(promise: Promise) =
      submit(promise) {
        RestoreGate.end()
        promise.resolve(null)
      }

  override fun restartProcess(promise: Promise) {
    val activity = reactContext.currentActivity
    com.facebook.react.bridge.UiThreadUtil.runOnUiThread { ProcessRestart.restart(activity) }
    promise.resolve(null)
  }

  private fun reject(promise: Promise, e: Exception) {
    when (e) {
      is BackupPassword.PasswordException -> promise.reject(e.code.name, "Password not accepted")
      is BackupFormatException -> promise.reject(e.code.name, "Backup can't be used")
      is BackupFiles.InsufficientSpace ->
          promise.reject(INSUFFICIENT_SPACE, JSONObject().put("needed", e.needed).put("available", e.available).toString())
      is RestoreException -> promise.reject(e.code, "Restore can't continue")
      is VaultException -> promise.reject(RestoreException.UNAVAILABLE, "Key unavailable")
      is IllegalStateException -> promise.reject("INVALID_STATE", "No restore in progress")
      is IllegalArgumentException -> promise.reject("INVALID_ARGUMENT", "Invalid argument")
      else -> promise.reject("RESTORE_FAILED", "Restore preparation failed")
    }
  }

  companion object {
    const val NAME = "TrezorRestore"
    const val INSUFFICIENT_SPACE = "INSUFFICIENT_SPACE"
    private const val DATABASE_KEY = "database"
  }
}
