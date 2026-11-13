package com.trezor.app.lock

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.trezor.app.locale.LocaleStore
import com.trezor.app.locale.NativeText
import com.trezor.app.vault.NativeTrezorAppLockSpec
import org.json.JSONObject

/**
 * JS bridge for App Lock (Phase 5). Authentication is AndroidX BiometricPrompt with the
 * device's own biometrics or, as the system offers, its PIN, pattern or password. The result
 * is decided by the system: only [BiometricPrompt.AuthenticationCallback.onAuthenticationSucceeded]
 * unlocks or changes the setting, and JavaScript has no call that unlocks by itself.
 *
 * No key is bound to authentication: App Lock is access control, the data is encrypted either
 * way (spec decision for Phase 5). Never logs anything about the user.
 */
class TrezorAppLockModule(private val reactContext: ReactApplicationContext) :
    NativeTrezorAppLockSpec(reactContext) {

  /** Main thread only: one prompt at a time. */
  private var prompting = false

  private val emit = {
    if (reactContext.hasActiveReactInstance()) {
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(CHANGED_EVENT, null)
    }
  }

  init {
    AppLock.addListener(emit)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    AppLock.removeListener(emit)
    super.invalidate()
  }

  /** JSON { enabled, locked, availability: 'available' | 'noCredential' | 'unavailable' }. */
  override fun getState(): String {
    val state = AppLock.state(reactContext)
    return JSONObject()
        .put("enabled", state.enabled)
        .put("locked", state.locked)
        .put("availability", availability())
        .toString()
  }

  private fun availability(): String =
      when (BiometricManager.from(reactContext).canAuthenticate(AUTHENTICATORS)) {
        BiometricManager.BIOMETRIC_SUCCESS -> "available"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "noCredential"
        else -> "unavailable"
      }

  override fun authenticate(promise: Promise) =
      prompt(promise, text(NativeText.UNLOCK_TITLE), null) {
        AppLock.unlock()
        promise.resolve(null)
      }

  override fun confirm(title: String, promise: Promise) =
      prompt(promise, title, text(NativeText.CONFIRM_SUBTITLE)) { promise.resolve(null) }

  override fun setEnabled(enabled: Boolean, promise: Promise) {
    val available = availability() == "available"
    when {
      enabled && !available -> promise.reject(UNAVAILABLE, "No screen lock or biometrics set up")
      // Without any credential there is nothing to confirm with; removing the device's
      // screen lock already required it.
      !enabled && !available ->
          UiThreadUtil.runOnUiThread {
            AppLock.setEnabled(reactContext, false)
            promise.resolve(null)
          }
      else ->
          prompt(
              promise,
              text(if (enabled) NativeText.APP_LOCK_ON_TITLE else NativeText.APP_LOCK_OFF_TITLE),
              text(NativeText.CONFIRM_SUBTITLE),
          ) {
            AppLock.setEnabled(reactContext, enabled)
            promise.resolve(null)
          }
    }
  }

  /** Prompt text in the app's language. */
  private fun text(text: NativeText) = LocaleStore.text(reactContext, text)

  private fun prompt(promise: Promise, title: String, subtitle: String?, onSuccess: () -> Unit) {
    UiThreadUtil.runOnUiThread {
      val activity = reactContext.currentActivity as? FragmentActivity
      when {
        activity == null -> promise.reject("NO_ACTIVITY", "Trezor is not in the foreground")
        prompting -> promise.reject("BUSY", "Authentication already in progress")
        else -> {
          prompting = true
          val callback =
              object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                  prompting = false
                  onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                  prompting = false
                  promise.reject(errorCodeOf(errorCode), "Not authenticated")
                }
                // onAuthenticationFailed: one rejected try; the system prompt stays open and
                // handles retries and lockout itself.
              }
          try {
            val info =
                BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .apply { if (subtitle != null) setSubtitle(subtitle) }
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .build()
            BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(info)
          } catch (e: Exception) {
            prompting = false
            promise.reject(UNAVAILABLE, "Authentication can't be started")
          }
        }
      }
    }
  }

  companion object {
    const val NAME = "TrezorAppLock"
    const val CHANGED_EVENT = "trezorAppLockChanged"
    private const val UNAVAILABLE = "UNAVAILABLE"
    /** Biometrics, or the device's PIN, pattern or password (supported on every API level by AndroidX). */
    private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    internal fun errorCodeOf(errorCode: Int): String =
        when (errorCode) {
          BiometricPrompt.ERROR_USER_CANCELED,
          BiometricPrompt.ERROR_NEGATIVE_BUTTON,
          BiometricPrompt.ERROR_CANCELED -> "CANCELLED"
          BiometricPrompt.ERROR_LOCKOUT,
          BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKOUT"
          BiometricPrompt.ERROR_NO_BIOMETRICS,
          BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL,
          BiometricPrompt.ERROR_HW_NOT_PRESENT,
          BiometricPrompt.ERROR_HW_UNAVAILABLE -> UNAVAILABLE
          else -> "FAILED"
        }
  }
}
