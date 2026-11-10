package com.trezor.app.restore

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.trezor.app.MainActivity

/**
 * Ends the process after a restore (Phase 6 spec v2.4 §8.10). Only while the app is in the
 * foreground (the current activity is `MainActivity` and at least RESUMED, L8) is
 * `MainActivity` started again with `Intent.makeRestartActivityTask`; otherwise no activity is
 * started (Android 14+ background-start limits) and recovery runs at the next launch. In every
 * case the task is finished and the process killed. The journal must be durable before this
 * is called.
 *
 * Called after the swap (§8.2 step 16), from `src/backup/restore.ts`.
 */
object ProcessRestart {

  /** The foreground test of L8. */
  fun isForeground(isMainActivity: Boolean, state: Lifecycle.State?): Boolean =
      isMainActivity && state != null && state.isAtLeast(Lifecycle.State.RESUMED)

  /** Returns only if [activity] is null and the kill fails; normally doesn't return. */
  fun restart(activity: Activity?) {
    if (activity != null) {
      val state = (activity as? LifecycleOwner)?.lifecycle?.currentState
      if (isForeground(activity is MainActivity, state)) {
        activity.startActivity(Intent.makeRestartActivityTask(ComponentName(activity, MainActivity::class.java)))
      }
      activity.finishAffinity()
    }
    android.os.Process.killProcess(android.os.Process.myPid())
  }
}
