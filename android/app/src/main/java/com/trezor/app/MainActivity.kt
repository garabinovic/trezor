package com.trezor.app

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.trezor.app.lock.AppLock
import com.trezor.app.reminders.ReminderTaps

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Trezor"

  override fun onCreate(savedInstanceState: Bundle?) {
    // react-native-screens cannot restore its fragments after the process was killed in the
    // background (e.g. when a reminder notification is tapped later); this factory prevents
    // the crash, as the library documents.
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    // App Lock: the window is private before anything is drawn when locked.
    AppLock.onCreate(this)
    super.onCreate(savedInstanceState)
    // A tapped reminder notification that launched the app (not a recreation).
    if (savedInstanceState == null) ReminderTaps.handle(intent)
  }

  override fun onResume() {
    super.onResume()
    AppLock.onResume(this)
  }

  override fun onPause() {
    // Before the Recents snapshot is taken.
    AppLock.onPause(this)
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // Recents can show the still-resumed app live: private as soon as it loses focus.
    AppLock.onWindowFocusChanged(this, hasFocus)
  }

  override fun onStop() {
    super.onStop()
    AppLock.onStop(this)
  }

  /**
   * Every activity Trezor starts itself (pickers, Save a copy, the share sheet, the
   * device-credential screen) goes through here: leaving for it doesn't lock (App Lock).
   */
  @Deprecated("Called by the framework and AndroidX for every start")
  override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
    AppLock.onLaunchingActivity()
    try {
      super.startActivityForResult(intent, requestCode, options)
    } catch (e: RuntimeException) {
      AppLock.onLaunchFailed()
      throw e
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    ReminderTaps.handle(intent)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
