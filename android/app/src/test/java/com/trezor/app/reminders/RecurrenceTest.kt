package com.trezor.app.reminders

import java.io.File
import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Runs the same fixtures as Jest (test-fixtures/recurrence.txt) on the JVM. */
class RecurrenceTest {

  private val fixtures: File =
      listOf("../../test-fixtures/recurrence.txt", "test-fixtures/recurrence.txt")
          .map(::File)
          .first { it.isFile }

  @Test
  fun sharedFixtures() {
    val lines =
        fixtures.readLines().withIndex().filter { (_, l) ->
          l.isNotBlank() && !l.trimStart().startsWith("#")
        }
    assertTrue("fixtures present", lines.size > 25)
    val failures = mutableListOf<String>()
    for ((index, line) in lines) {
      val p = line.split("|").map { it.trim() }
      val (tz, mode, localStart, startAt, interval, after, expected) =
          Seven(p[0], p[1], p[2], p[3], p[4], p[5], p[6])
      val spec =
          Recurrence.Spec(
              Recurrence.Mode.of(mode)!!,
              if (startAt == "-") 0L else Instant.parse(startAt).toEpochMilli(),
              if (localStart == "-") Recurrence.LocalDateTime(2000, 1, 1, 0, 0)
              else Recurrence.LocalDateTime.parse(localStart)!!,
              if (interval == "-") null else interval.toInt(),
          )
      val next =
          Recurrence.nextOccurrence(
              spec,
              Instant.parse(after).toEpochMilli(),
              TimeZone.getTimeZone(tz),
          )
      val actual = next?.let { Instant.ofEpochMilli(it).toString() } ?: "-"
      val wanted = if (expected == "-") "-" else Instant.parse(expected).toString()
      if (actual != wanted) failures += "line ${index + 1}: expected $wanted, got $actual"
    }
    assertEquals(emptyList<String>(), failures)
  }

  @Test
  fun dayNumberRoundTripsAcrossCenturies() {
    assertEquals(0L, Recurrence.dayNumber(1970, 1, 1))
    assertEquals(20759L, Recurrence.dayNumber(2026, 11, 2))
    assertEquals(-1L, Recurrence.dayNumber(1969, 12, 31))
  }

  @Test
  fun invalidIntervalsHaveNoOccurrence() {
    for (minutes in listOf(null, 0, 14, 30 * 24 * 60 + 1)) {
      assertNull(
          Recurrence.nextOccurrence(
              Recurrence.Spec(
                  Recurrence.Mode.INTERVAL,
                  0L,
                  Recurrence.LocalDateTime(2000, 1, 1, 0, 0),
                  minutes,
              ),
              1L,
              TimeZone.getTimeZone("UTC"),
          ),
      )
    }
  }

  @Test
  fun parseRejectsInvalidDates() {
    for (bad in listOf("2026-02-29T10:00", "2026-13-01T10:00", "2026-01-01T24:00", "x")) {
      assertNull(Recurrence.LocalDateTime.parse(bad))
    }
  }

  private data class Seven(
      val a: String,
      val b: String,
      val c: String,
      val d: String,
      val e: String,
      val f: String,
      val g: String,
  )
}
