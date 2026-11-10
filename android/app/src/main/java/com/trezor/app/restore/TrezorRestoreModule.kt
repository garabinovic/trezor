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
 * JS bridge for [RestoreService] and [RestoreRecovery]: the document stream, Android services
 * and JSON. The rules live in the JVM-tested classes of this package. Every call runs on one
 * worker lane, so a step is never interrupted by another. Never logs a password, key, id,
 * name or URI.
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
  private val recovery = RestoreRecovery(layout, ops, AndroidPathTypes, schedule)
  private val tasks = ModuleTasks()
  /** The recovery run this module started and hasn't ended (worker lane only), for [invalidate]. */
  private var recoveryToken: String? = null

  override fun getName(): String = NAME

  override fun invalidate() {
    // The coordinator is gone with this instance: attachment work must not stay refused, and
    // recovery must be able to run. Released on the worker lane, so only after the step in
    // flight has returned (v2.5 §5.3); a journal (if any) stays for recovery.
    val release = {
      service.release()
      recoveryToken?.let(RestoreLock.PROCESS::endRecover)
      recoveryToken = null
      RestoreGate.end()
    }
    tasks.submit(WORKER, { _, _ -> release() }) { release() }
    tasks.shutdown {}
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

  // --- §8.2 steps 13a–15 -------------------------------------------------------------------

  override fun swapRestore(sessionId: String, promise: Promise) =
      submit(promise) {
        check(RestoreGate.isHeld()) { "Restore gate not held" }
        promise.resolve(service.swap(sessionId, recovery).json)
      }

  // --- Startup recovery and Cancel restore (v2.5 §2, §7) -------------------------------------

  /** Refused (`RESTORE_IN_PROGRESS`) while any recovery run or restore session holds the lock. */
  override fun recoveryBegin(promise: Promise) =
      submit(promise) {
        val token = RestoreLock.PROCESS.recover()
        recoveryToken = token
        promise.resolve(token)
      }

  override fun recoveryRun(token: String, promise: Promise) =
      submit(promise) {
        requireRecovery(token)
        val json =
            when (val outcome = recovery.run()) {
              RestoreRecovery.Outcome.Done -> JSONObject().put("status", "done")
              is RestoreRecovery.Outcome.Verify ->
                  JSONObject()
                      .put("status", "verify")
                      .put("location", layout.databaseDir.absolutePath)
                      .put("name", layout.liveDb.name)
                      .put("attachmentIds", JSONArray(outcome.attachmentIds))
            }
        promise.resolve(json.toString())
      }

  override fun finishVerification(token: String, outcome: String, promise: Promise) =
      submit(promise) {
        requireRecovery(token)
        val result =
            RestoreRecovery.Verification.values().firstOrNull { it.name.equals(outcome, ignoreCase = true) }
                ?: throw IllegalArgumentException("Unknown outcome")
        recovery.finishVerification(result)
        promise.resolve(null)
      }

  override fun previousData(token: String, promise: Promise) =
      submit(promise) {
        requireRecovery(token)
        val ids = recovery.previousData()
        promise.resolve(
            JSONObject()
                .put("location", layout.restoreDbDir.absolutePath)
                .put("name", layout.previousDb.name)
                .put("attachmentIds", JSONArray(ids))
                .toString())
      }

  override fun cancelRestore(token: String, promise: Promise) =
      submit(promise) {
        requireRecovery(token)
        recovery.cancel()
        promise.resolve(null)
      }

  /** Ends the run of [token]; another token (a refused caller's) changes nothing. */
  override fun recoveryEnd(token: String, promise: Promise) =
      submit(promise) {
        RestoreLock.PROCESS.endRecover(token)
        if (recoveryToken == token) recoveryToken = null
        promise.resolve(null)
      }

  private fun requireRecovery(token: String) {
    if (!RestoreLock.PROCESS.isRecovering(token)) throw RestoreException(RestoreException.IN_PROGRESS, "Not the recovery run holding the lock")
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
