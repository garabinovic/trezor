package com.trezor.app.reminders

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Real AlarmManager, NotificationManager and Keystore on the device/emulator. */
@RunWith(AndroidJUnit4::class)
class ReminderSchedulerTest {

  private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
  private val notifications =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private val hour = 3_600_000L

  private fun entry(
      id: String,
      mode: Recurrence.Mode,
      startAt: Long,
      title: String? = null,
      body: String? = null,
      interval: Int? = null,
  ): ScheduleStore.Entry {
    val local = Recurrence.localOf(startAt, TimeZone.getDefault())
    val localStart =
        "%04d-%02d-%02dT%02d:%02d"
            .format(local.year, local.month, local.day, local.hour, local.minute)
    return ScheduleStore.Entry(id, mode, startAt, localStart, interval, title, body, null)
  }

  private fun shown(id: String) =
      notifications.activeNotifications.firstOrNull { it.tag == "reminder:$id" }

  @Before
  fun setUp() {
    if (Build.VERSION.SDK_INT >= 33) {
      InstrumentationRegistry.getInstrumentation()
          .uiAutomation
          .grantRuntimePermission(context.packageName, "android.permission.POST_NOTIFICATIONS")
    }
    ReminderScheduler.sync(context, emptyList(), false)
    notifications.cancelAll()
  }

  @After
  fun tearDown() {
    ReminderScheduler.sync(context, emptyList(), false)
    notifications.cancelAll()
  }

  @Test
  fun scheduleIsEncryptedAtRest() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(
        context,
        listOf(entry("a", Recurrence.Mode.ONCE, now + hour, "Secret title", "Secret body")),
        true,
    )
    val raw = String(File(context.noBackupFilesDir, "reminders/schedule.bin").readBytes(), Charsets.ISO_8859_1)
    assertFalse(raw.contains("Secret"))
    assertFalse(raw.contains("\"id\""))
    assertEquals("Secret title", ScheduleStore.load(context).entries.single().title)
  }

  @Test
  fun tamperedScheduleReadsAsEmptyAndIsRebuiltBySync() {
    val now = System.currentTimeMillis()
    val a = entry("a", Recurrence.Mode.DAILY, now + hour)
    ReminderScheduler.sync(context, listOf(a), false)
    val file = File(context.noBackupFilesDir, "reminders/schedule.bin")
    val bytes = file.readBytes()
    bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
    file.writeBytes(bytes)
    assertTrue(ScheduleStore.load(context).entries.isEmpty())
    ReminderScheduler.sync(context, listOf(a), false)
    assertEquals(1, ScheduleStore.load(context).entries.size)
  }

  @Test
  fun syncArmsReplacesAndCancelsIdempotently() {
    val now = System.currentTimeMillis()
    val a = entry("a", Recurrence.Mode.DAILY, now + hour)
    val b = entry("b", Recurrence.Mode.INTERVAL, now - hour, interval = 240)
    repeat(3) { ReminderScheduler.sync(context, listOf(a, b), false) }
    assertTrue(ReminderScheduler.isArmed(context, "a"))
    assertTrue(ReminderScheduler.isArmed(context, "b"))
    val record = ScheduleStore.load(context)
    assertEquals(listOf("a", "b"), record.entries.map { it.id })
    // b: anchor one hour ago, every 4 h → next is in three hours (minute precision).
    assertEquals((now - hour + 4 * hour) / 60_000, record.entries[1].armedFor!! / 60_000)

    ReminderScheduler.sync(context, listOf(b), false)
    assertFalse(ReminderScheduler.isArmed(context, "a"))
    assertTrue(ReminderScheduler.isArmed(context, "b"))
  }

  @Test
  fun onceInThePastIsNotArmed() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(context, listOf(entry("old", Recurrence.Mode.ONCE, now - hour)), false)
    assertFalse(ReminderScheduler.isArmed(context, "old"))
    assertNull(ScheduleStore.load(context).entries.single().armedFor)
  }

  @Test
  fun firingOnceShowsGenericContentAndRecordsIt() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(
        context,
        listOf(entry("o", Recurrence.Mode.ONCE, now + hour, "Pay rent", "Bank")),
        false, // details hidden
    )
    ReminderScheduler.onFire(context, "o", null)
    val n = shown("o")
    assertNotNull(n)
    val extras = n!!.notification.extras
    assertEquals("Trezor", extras.getCharSequence("android.title").toString())
    assertEquals("You have a reminder.", extras.getCharSequence("android.text").toString())
    assertFalse(ReminderScheduler.isArmed(context, "o"))
    assertEquals(listOf("o"), ReminderScheduler.firedOnceIds(context))

    // Once the app marks it completed, the next sync drops it and clears "fired".
    ReminderScheduler.sync(context, emptyList(), false)
    assertTrue(ReminderScheduler.firedOnceIds(context).isEmpty())
    assertNull(shown("o"))
  }

  @Test
  fun firingWithDetailsShowsTitleAndDescription() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(
        context,
        listOf(entry("d", Recurrence.Mode.DAILY, now + hour, "Water plants", "Balcony")),
        true,
    )
    ReminderScheduler.onFire(context, "d", null)
    val extras = shown("d")!!.notification.extras
    assertEquals("Water plants", extras.getCharSequence("android.title").toString())
    assertEquals("Balcony", extras.getCharSequence("android.text").toString())
    assertNotNull(shown("d")!!.notification.publicVersion)
  }

  @Test
  fun firingDailyArmsTheNextOccurrence() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(context, listOf(entry("d", Recurrence.Mode.DAILY, now + 60_000)), false)
    val first = ScheduleStore.load(context).entries.single().armedFor!!
    ReminderScheduler.onFire(context, "d", null)
    val next = ScheduleStore.load(context).entries.single().armedFor!!
    assertTrue(ReminderScheduler.isArmed(context, "d"))
    assertTrue(next > first)
    assertTrue(next - first in (23 * hour)..(25 * hour))
  }

  @Test
  fun theSecondAlarmOfAPairDoesNotNotifyTwice() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(context, listOf(entry("w", Recurrence.Mode.DAILY, now + 60_000)), false)
    val occurrence = ScheduleStore.load(context).entries.single().armedFor!!
    ReminderScheduler.onFire(context, "w", occurrence) // windowed alarm
    val next = ScheduleStore.load(context).entries.single().armedFor
    notifications.cancelAll()
    ReminderScheduler.onFire(context, "w", occurrence) // while-idle alarm, same occurrence
    assertNull(shown("w"))
    assertEquals(next, ScheduleStore.load(context).entries.single().armedFor)
  }

  /** Simulates an occurrence that came due a moment ago and is still awaiting delivery. */
  private fun armedInThePast(e: ScheduleStore.Entry, occurrence: Long) {
    ReminderScheduler.sync(context, listOf(e), false)
    ScheduleStore.update(context) { r ->
      r.copy(entries = r.entries.map { it.copy(armedFor = occurrence) })
    }
  }

  @Test
  fun rearmingKeepsAnOccurrenceThatIsDueButNotYetDelivered() {
    val now = System.currentTimeMillis()
    val due = (now / 60_000 - 1) * 60_000 // a whole minute, 1–2 minutes ago
    armedInThePast(entry("once", Recurrence.Mode.ONCE, due), due)
    ReminderScheduler.rearmAll(context) // e.g. TIME_SET while inside the delivery window
    assertEquals(due, ScheduleStore.load(context).entries.single().armedFor)
    assertTrue(ReminderScheduler.isArmed(context, "once"))
    ReminderScheduler.sync(context, listOf(entry("once", Recurrence.Mode.ONCE, due)), false)
    assertEquals(due, ScheduleStore.load(context).entries.single().armedFor)
    ReminderScheduler.onFire(context, "once", due)
    assertNotNull(shown("once"))
    assertEquals(listOf("once"), ReminderScheduler.firedOnceIds(context))
    // Delivered: a later sync no longer arms it.
    ReminderScheduler.sync(context, listOf(entry("once", Recurrence.Mode.ONCE, due)), false)
    assertFalse(ReminderScheduler.isArmed(context, "once"))
  }

  @Test
  fun aPendingRecurringOccurrenceIsDeliveredOnceThenTheRhythmContinues() {
    val now = System.currentTimeMillis()
    val due = (now / 60_000 - 1) * 60_000 // a whole minute, 1–2 minutes ago
    armedInThePast(entry("daily", Recurrence.Mode.DAILY, due), due)
    ReminderScheduler.rearmAll(context)
    assertEquals(due, ScheduleStore.load(context).entries.single().armedFor)
    ReminderScheduler.onFire(context, "daily", due)
    assertNotNull(shown("daily"))
    val next = ScheduleStore.load(context).entries.single().armedFor!!
    assertTrue(next - due in (23 * hour)..(25 * hour))
  }

  @Test
  fun aChangedScheduleDoesNotKeepTheOldPendingOccurrence() {
    val now = System.currentTimeMillis()
    val due = (now / 60_000 - 1) * 60_000 // a whole minute, 1–2 minutes ago
    armedInThePast(entry("c", Recurrence.Mode.ONCE, due), due)
    ReminderScheduler.sync(context, listOf(entry("c", Recurrence.Mode.ONCE, now + hour)), false)
    assertEquals(now + hour, ScheduleStore.load(context).entries.single().armedFor)
  }

  @Test
  fun firingAnUnknownReminderShowsNothingAndRecreatesNothing() {
    ReminderScheduler.onFire(context, "deleted", null)
    assertNull(shown("deleted"))
    assertFalse(ReminderScheduler.isArmed(context, "deleted"))
    assertTrue(ScheduleStore.load(context).entries.isEmpty())
  }

  @Test
  fun privacyChangeKeepsTimesAndReplacesContent() {
    val now = System.currentTimeMillis()
    val withText = entry("p", Recurrence.Mode.WEEKLY, now + hour, "Title", "Body")
    ReminderScheduler.sync(context, listOf(withText), true)
    val armed = ScheduleStore.load(context).entries.single().armedFor
    ReminderScheduler.sync(context, listOf(withText.copy(title = null, body = null)), false)
    val after = ScheduleStore.load(context)
    assertFalse(after.showDetails)
    assertNull(after.entries.single().title)
    assertEquals(armed, after.entries.single().armedFor)
  }

  @Test
  fun rearmAllRestoresAlarms() {
    val now = System.currentTimeMillis()
    ReminderScheduler.sync(context, listOf(entry("r", Recurrence.Mode.MONTHLY, now + hour)), false)
    ReminderScheduler.rearmAll(context)
    assertTrue(ReminderScheduler.isArmed(context, "r"))
  }

  @Test
  fun tappedNotificationIdIsConsumedOnce() {
    val intent =
        Intent(ReminderNotifications.ACTION_OPEN).putExtra(ReminderScheduler.EXTRA_ID, "x")
    ReminderTaps.handle(intent)
    assertEquals("x", ReminderTaps.consume())
    assertNull(ReminderTaps.consume())
    ReminderTaps.handle(Intent("other.action").putExtra(ReminderScheduler.EXTRA_ID, "y"))
    assertNull(ReminderTaps.consume())
  }
}
