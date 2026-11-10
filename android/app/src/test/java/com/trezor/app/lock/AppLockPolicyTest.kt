package com.trezor.app.lock

import androidx.biometric.BiometricPrompt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When App Lock locks and when the window is private (Phase 5). */
class AppLockPolicyTest {

  private val grace = AppLockPolicy.EXTERNAL_GRACE_MS

  /** Enabled and unlocked, in front. */
  private fun unlocked() = AppLockPolicy(enabled = true).apply { unlock(); onResume(0); onFocusChanged(true) }

  @Test
  fun disabledNeverLocksAndNeverHidesTheWindow() {
    val p = AppLockPolicy(enabled = false)
    assertFalse(p.locked)
    p.onPause()
    p.onStop(changingConfigurations = false, now = 0)
    p.onResume(10 * grace)
    assertFalse(p.locked)
    assertFalse(p.secure)
  }

  @Test
  fun enabledStartsLockedAndOnlyUnlockUnlocks() {
    val p = AppLockPolicy(enabled = true)
    assertTrue(p.locked)
    p.onResume(0)
    assertTrue("a resume alone is not an authentication", p.locked)
    assertTrue(p.secure)
    p.unlock()
    assertFalse(p.locked)
    assertTrue("no window focus yet", p.secure)
    p.onFocusChanged(true)
    assertFalse("unlocked, in front, focused: screenshots allowed", p.secure)
  }

  @Test
  fun leavingTheAppLocksAndHidesTheWindowBeforeTheSnapshot() {
    val p = unlocked()
    p.onPause()
    // Paused (Recents, a dialog over the app): private before the snapshot, still unlocked.
    assertTrue(p.secure)
    assertFalse(p.locked)
    p.onStop(changingConfigurations = false, now = 0)
    assertTrue(p.locked)
    p.onResume(1)
    assertTrue(p.locked)
    assertTrue(p.secure)
  }

  /** Recents on recent Android shows the still-resumed app live: losing focus hides it. */
  @Test
  fun losingWindowFocusHidesTheWindowWithoutLocking() {
    val p = unlocked()
    assertFalse(p.secure)
    p.onFocusChanged(false)
    assertTrue(p.secure)
    assertFalse(p.locked)
    p.onFocusChanged(true)
    assertFalse(p.secure)
    // Disabled: never private.
    val off = AppLockPolicy(enabled = false).apply { onResume(0) }
    off.onFocusChanged(false)
    assertFalse(off.secure)
  }

  @Test
  fun aPauseWithoutAStopDoesNotLock() {
    val p = unlocked()
    p.onPause() // e.g. the system biometric dialog over the activity
    p.onResume(1)
    p.onFocusChanged(true)
    assertFalse(p.locked)
    assertFalse(p.secure)
  }

  @Test
  fun aConfigurationChangeDoesNotLock() {
    val p = unlocked()
    p.onPause()
    p.onStop(changingConfigurations = true, now = 0)
    p.onResume(1)
    assertFalse(p.locked)
  }

  @Test
  fun anActivityTrezorStartedDoesNotLockWithinTheGrace() {
    val p = unlocked()
    p.onLaunchingActivity()
    p.onPause()
    p.onStop(changingConfigurations = false, now = 1_000)
    assertFalse(p.locked)
    assertTrue("still private while the picker is in front", p.secure)
    p.onResume(1_000 + grace)
    p.onFocusChanged(true)
    assertFalse(p.locked)
    assertFalse(p.secure)
  }

  @Test
  fun awayLongerThanTheGraceInAnActivityTrezorStartedLocks() {
    val p = unlocked()
    p.onLaunchingActivity()
    p.onPause()
    p.onStop(changingConfigurations = false, now = 1_000)
    p.onResume(1_000 + grace + 1)
    assertTrue(p.locked)
  }

  @Test
  fun theLaunchFlagLastsOnlyUntilTheNextResume() {
    val p = unlocked()
    p.onLaunchingActivity()
    p.onPause()
    p.onStop(changingConfigurations = false, now = 0)
    p.onResume(1)
    // Back from the picker; now the user leaves with Home.
    p.onPause()
    p.onStop(changingConfigurations = false, now = 2)
    assertTrue(p.locked)
  }

  @Test
  fun aFailedLaunchLeavesNothingThatWouldSkipTheLock() {
    val p = unlocked()
    p.onLaunchingActivity()
    p.onLaunchFailed()
    p.onPause()
    p.onStop(changingConfigurations = false, now = 0)
    assertTrue(p.locked)
  }

  @Test
  fun turningOnOrOffNeverLeavesItLocked() {
    val p = AppLockPolicy(enabled = false)
    p.onResume(0)
    p.setEnabled(true)
    assertTrue(p.enabled)
    assertFalse(p.locked)
    p.onPause()
    p.onStop(changingConfigurations = false, now = 0)
    assertTrue(p.locked)
    p.setEnabled(false)
    assertFalse(p.locked)
    assertFalse(p.secure)
  }

  @Test
  fun systemErrorsMapToTheirCodes() {
    val cases =
        mapOf(
            BiometricPrompt.ERROR_USER_CANCELED to "CANCELLED",
            BiometricPrompt.ERROR_NEGATIVE_BUTTON to "CANCELLED",
            BiometricPrompt.ERROR_CANCELED to "CANCELLED",
            BiometricPrompt.ERROR_LOCKOUT to "LOCKOUT",
            BiometricPrompt.ERROR_LOCKOUT_PERMANENT to "LOCKOUT",
            BiometricPrompt.ERROR_NO_BIOMETRICS to "UNAVAILABLE",
            BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL to "UNAVAILABLE",
            BiometricPrompt.ERROR_HW_NOT_PRESENT to "UNAVAILABLE",
            BiometricPrompt.ERROR_HW_UNAVAILABLE to "UNAVAILABLE",
            BiometricPrompt.ERROR_TIMEOUT to "FAILED",
        )
    for ((error, code) in cases) assertEquals("error $error", code, TrezorAppLockModule.errorCodeOf(error))
  }
}
