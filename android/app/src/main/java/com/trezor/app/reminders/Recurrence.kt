package com.trezor.app.reminders

import java.util.Calendar
import java.util.TimeZone

/**
 * Reminder recurrence rules, mirrored from src/reminders/recurrence.ts so the
 * background receiver computes the same times as the app. Both are checked
 * against test-fixtures/recurrence.txt.
 */
object Recurrence {

  enum class Mode(val jsValue: String) {
    ONCE("once"),
    DAILY("daily"),
    WEEKLY("weekly"),
    MONTHLY("monthly"),
    YEARLY("yearly"),
    INTERVAL("interval");

    companion object {
      fun of(value: String): Mode? = values().firstOrNull { it.jsValue == value }
    }
  }

  data class LocalDateTime(
      val year: Int,
      val month: Int, // 1–12
      val day: Int,
      val hour: Int,
      val minute: Int,
  ) {
    companion object {
      private val PATTERN = Regex("^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$")

      fun parse(value: String): LocalDateTime? {
        val m = PATTERN.matchEntire(value) ?: return null
        val (y, mo, d, h, mi) = m.destructured
        val f = LocalDateTime(y.toInt(), mo.toInt(), d.toInt(), h.toInt(), mi.toInt())
        if (f.month !in 1..12 || f.day < 1 || f.day > daysInMonth(f.year, f.month)) return null
        if (f.hour > 23 || f.minute > 59) return null
        return f
      }
    }
  }

  data class Spec(
      val mode: Mode,
      /** UTC ms. ONCE: the moment. INTERVAL: the anchor. */
      val startAt: Long,
      /** Floating local start for calendar modes. */
      val localStart: LocalDateTime,
      val intervalMinutes: Int?,
  )

  const val MIN_INTERVAL_MINUTES = 15
  const val MAX_INTERVAL_MINUTES = 30 * 24 * 60

  private const val MINUTE = 60_000L
  private const val DAY = 86_400_000L
  private const val MAX_STEPS = 16

  fun daysInMonth(year: Int, month: Int): Int =
      when (month) {
        2 -> if ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
      }

  fun localOf(t: Long, zone: TimeZone): LocalDateTime {
    val c = Calendar.getInstance(zone)
    c.timeInMillis = t
    return LocalDateTime(
        c.get(Calendar.YEAR),
        c.get(Calendar.MONTH) + 1,
        c.get(Calendar.DAY_OF_MONTH),
        c.get(Calendar.HOUR_OF_DAY),
        c.get(Calendar.MINUTE),
    )
  }

  /** Days since 1970-01-01 for a proleptic Gregorian date (zone-independent). */
  fun dayNumber(y: Int, m: Int, d: Int): Long {
    val yy = if (m <= 2) y - 1 else y
    val era = Math.floorDiv(yy, 400)
    val yoe = yy - era * 400
    val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097L + doe - 719468L
  }

  private data class Date(val year: Int, val month: Int, val day: Int)

  private fun fromDayNumber(n: Long): Date {
    val z = n + 719468L
    val era = Math.floorDiv(z, 146097L)
    val doe = z - era * 146097L
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
    val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
    return Date(y, m, d)
  }

  private fun wallMillis(f: LocalDateTime): Long =
      dayNumber(f.year, f.month, f.day) * DAY + f.hour * 3_600_000L + f.minute * MINUTE

  private fun offsetAt(t: Long, zone: TimeZone): Long {
    val floored = t - Math.floorMod(t, MINUTE)
    return wallMillis(localOf(t, zone)) - floored
  }

  /**
   * Instant of a local wall-clock time in [zone]. Twice-occurring time: the earlier
   * instant. Non-existent time (DST gap): moved forward by the gap.
   */
  fun localToInstant(f: LocalDateTime, zone: TimeZone): Long {
    val wall = wallMillis(f)
    val offsets =
        linkedSetOf(offsetAt(wall - DAY, zone), offsetAt(wall, zone), offsetAt(wall + DAY, zone))
    val match = offsets.map { wall - it }.filter { localOf(it, zone) == f }.minOrNull()
    return match ?: (wall - offsetAt(wall - DAY, zone))
  }

  /** First occurrence strictly after [after], or null if there is none. */
  fun nextOccurrence(spec: Spec, after: Long, zone: TimeZone): Long? {
    val s = spec.localStart
    fun at(date: Date) =
        localToInstant(LocalDateTime(date.year, date.month, date.day, s.hour, s.minute), zone)

    when (spec.mode) {
      Mode.ONCE -> return if (spec.startAt > after) spec.startAt else null

      Mode.INTERVAL -> {
        val minutes = spec.intervalMinutes ?: return null
        if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) return null
        val step = minutes * MINUTE
        if (spec.startAt > after) return spec.startAt
        val k = Math.floorDiv(after - spec.startAt, step) + 1
        return spec.startAt + k * step
      }

      Mode.DAILY,
      Mode.WEEKLY -> {
        val step = if (spec.mode == Mode.DAILY) 1L else 7L
        val startDay = dayNumber(s.year, s.month, s.day)
        val a = localOf(after, zone)
        val afterDay = dayNumber(a.year, a.month, a.day)
        var k = maxOf(0L, Math.floorDiv(afterDay - startDay, step) - 1)
        repeat(MAX_STEPS) {
          val t = at(fromDayNumber(startDay + k * step))
          if (t > after) return t
          k++
        }
        return null
      }

      Mode.MONTHLY -> {
        val startIndex = s.year * 12 + (s.month - 1)
        val a = localOf(after, zone)
        var k = maxOf(0, a.year * 12 + (a.month - 1) - startIndex - 1)
        repeat(MAX_STEPS) {
          val index = startIndex + k
          val year = Math.floorDiv(index, 12)
          val month = Math.floorMod(index, 12) + 1
          val t = at(Date(year, month, minOf(s.day, daysInMonth(year, month))))
          if (t > after) return t
          k++
        }
        return null
      }

      Mode.YEARLY -> {
        val a = localOf(after, zone)
        var k = maxOf(0, a.year - s.year - 1)
        repeat(MAX_STEPS) {
          val year = s.year + k
          val t = at(Date(year, s.month, minOf(s.day, daysInMonth(year, s.month))))
          if (t > after) return t
          k++
        }
        return null
      }
    }
  }
}
