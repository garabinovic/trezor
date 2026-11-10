package com.trezor.app.lock

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.WindowManager
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The process's App Lock state (Phase 5): the [AppLockPolicy], its one stored preference, and
 * the window's privacy flags. The source of truth is here, in native code: only
 * [TrezorAppLockModule] unlocks, from BiometricPrompt's success callback. JavaScript reads the
 * state and shows the lock screen; it can't unlock.
 *
 * The preference lives in private SharedPreferences, not in the database: it is device-local
 * (not in backups, so a restore never changes it), and it is needed before JavaScript runs.
 * `allowBackup="false"` keeps it out of cloud backups. It holds no secret.
 */
object AppLock {

  private const val PREFS = "trezor.applock"
  private const val KEY_ENABLED = "enabled"

  private var policy: AppLockPolicy? = null
  private var activity: WeakReference<Activity>? = null
  private val listeners = CopyOnWriteArraySet<() -> Unit>()

  class State(val enabled: Boolean, val locked: Boolean)

  @Synchronized
  fun init(context: Context) {
    if (policy == null) {
      val enabled = prefs(context).getBoolean(KEY_ENABLED, false)
      policy = AppLockPolicy(enabled)
    }
  }

  @Synchronized
  fun state(context: Context): State {
    init(context)
    val p = policy!!
    return State(p.enabled, p.locked)
  }

  fun addListener(listener: () -> Unit) = listeners.add(listener)

  fun removeListener(listener: () -> Unit) = listeners.remove(listener)

  // --- MainActivity lifecycle (main thread) --------------------------------------------------

  fun onCreate(activity: Activity) {
    init(activity)
    this.activity = WeakReference(activity)
    // Before the first frame: a locked app never shows its content, even for an instant.
    applyWindow(activity)
  }

  fun onLaunchingActivity() = change { it.onLaunchingActivity() }

  fun onLaunchFailed() = change { it.onLaunchFailed() }

  fun onPause(activity: Activity) {
    change { it.onPause() }
    // Before Android takes the Recents snapshot.
    applyWindow(activity)
  }

  fun onWindowFocusChanged(activity: Activity, hasFocus: Boolean) {
    change { it.onFocusChanged(hasFocus) }
    applyWindow(activity)
  }

  fun onStop(activity: Activity) = change { it.onStop(activity.isChangingConfigurations, System.currentTimeMillis()) }

  fun onResume(activity: Activity) {
    this.activity = WeakReference(activity)
    change { it.onResume(System.currentTimeMillis()) }
    applyWindow(activity)
  }

  // --- After a successful system authentication only ------------------------------------------

  internal fun unlock() {
    change { it.unlock() }
    activity?.get()?.let(::applyWindow)
  }

  internal fun setEnabled(context: Context, enabled: Boolean) {
    // commit(), not apply(): the choice is on disk before it is reported.
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).commit()
    change { it.setEnabled(enabled) }
    activity?.get()?.let(::applyWindow)
  }

  private fun change(block: (AppLockPolicy) -> Unit) {
    val before: Pair<Boolean, Boolean>
    val after: Pair<Boolean, Boolean>
    synchronized(this) {
      val p = policy ?: return
      before = p.enabled to p.locked
      block(p)
      after = p.enabled to p.locked
    }
    if (before != after) listeners.forEach { it() }
  }

  /** FLAG_SECURE while locked or not in front; no Recents snapshot at all while enabled (API 33+). */
  private fun applyWindow(activity: Activity) {
    val (secure, enabled) = synchronized(this) { (policy?.secure ?: false) to (policy?.enabled ?: false) }
    if (secure) {
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
    if (Build.VERSION.SDK_INT >= 33) activity.setRecentsScreenshotEnabled(!enabled)
  }

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
