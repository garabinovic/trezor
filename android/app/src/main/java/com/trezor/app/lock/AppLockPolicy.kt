package com.trezor.app.lock

/**
 * When App Lock locks, without Android types (Phase 5). App Lock is access control for the
 * UI only: the data stays encrypted with the same keys whether it is on or off.
 *
 * - Enabled at process start: locked until the user authenticates.
 * - The activity stops (Home, Recents, another app, screen off): locked, unless the stop is a
 *   configuration change, or an activity Trezor itself started (a file picker, Save a copy,
 *   the share sheet, the device-credential screen). Then it locks only if the user was away
 *   for longer than [externalGraceMs].
 * - Only a successful authentication ([unlock]) unlocks.
 *
 * [secure] says when the window must be FLAG_SECURE: while locked, and whenever the activity
 * isn't in front with window focus (so the Recents preview, which may be a live view of the
 * still-resumed app, and screenshots show nothing).
 */
class AppLockPolicy(enabled: Boolean, private val externalGraceMs: Long = EXTERNAL_GRACE_MS) {

  var enabled: Boolean = enabled
    private set

  var locked: Boolean = enabled
    private set

  /** Trezor is starting one of its own activities (set just before, cleared on resume). */
  private var launching = false
  /** When the activity stopped for such an activity. */
  private var awaySince: Long? = null
  private var resumed = false
  private var focused = false

  val secure: Boolean
    get() = enabled && (locked || !resumed || !focused)

  /** Recents, the notification shade or a dialog took focus (no pause on recent Android). */
  fun onFocusChanged(hasFocus: Boolean) {
    focused = hasFocus
  }

  fun onLaunchingActivity() {
    launching = true
  }

  /** The launch failed: nothing left the app. */
  fun onLaunchFailed() {
    launching = false
  }

  fun onPause() {
    resumed = false
  }

  fun onStop(changingConfigurations: Boolean, now: Long) {
    if (!enabled || changingConfigurations) return
    if (launching) {
      if (awaySince == null) awaySince = now
    } else {
      locked = true
    }
  }

  fun onResume(now: Long) {
    launching = false
    awaySince?.let { if (now - it > externalGraceMs) locked = true }
    awaySince = null
    resumed = true
  }

  /** Called only after the system reported a successful authentication. */
  fun unlock() {
    locked = false
  }

  /** Called only after a successful authentication (or, to turn off, without a credential). */
  fun setEnabled(value: Boolean) {
    enabled = value
    locked = false
    awaySince = null
  }

  companion object {
    /** Long enough to pick a file or share one; short enough not to leave Trezor open. */
    const val EXTERNAL_GRACE_MS = 3 * 60 * 1000L
  }
}
