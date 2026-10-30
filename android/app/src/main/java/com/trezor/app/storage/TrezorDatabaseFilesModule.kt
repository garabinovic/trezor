package com.trezor.app.storage

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.trezor.app.vault.NativeTrezorDatabaseFilesSpec

/** JS bridge for [DatabaseFiles], rooted at the directory op-sqlite uses by default. */
class TrezorDatabaseFilesModule(reactContext: ReactApplicationContext) :
    NativeTrezorDatabaseFilesSpec(reactContext) {

  private val files =
      DatabaseFiles(reactContext.getDatabasePath("placeholder.db").parentFile!!)

  override fun getName(): String = NAME

  override fun fileState(name: String, promise: Promise) =
      run(promise) { files.state(name).name.lowercase() }

  override fun renameNoReplace(from: String, to: String, promise: Promise) =
      run(promise) { files.renameNoReplace(from, to) }

  override fun deleteTemporary(name: String, promise: Promise) =
      run(promise) { files.deleteTemporary(name) }

  private inline fun run(promise: Promise, block: () -> Any?) {
    try {
      val result = block()
      promise.resolve(if (result is Unit) null else result)
    } catch (e: IllegalArgumentException) {
      promise.reject("INVALID_ARGUMENT", e.message, e)
    } catch (e: Exception) {
      promise.reject("DATABASE_STATE_UNKNOWN", e.message, e)
    }
  }

  companion object {
    const val NAME = "TrezorDatabaseFiles"
  }
}
