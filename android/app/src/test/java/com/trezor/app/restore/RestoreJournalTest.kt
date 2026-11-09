package com.trezor.app.restore

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RestoreJournalTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var layout: RestoreLayout
  private val synced = mutableListOf<File>()
  private lateinit var store: JournalStore

  private val journal =
      RestoreJournal(
          restoreId = "a".repeat(32),
          backupId = "b".repeat(32),
          phase = RestoreJournal.Phase.PREPARED,
          hadAttachments = true,
          scheduleSaved = RestoreJournal.Schedule.PENDING,
          createdAt = 1793000000000,
      )

  @Before
  fun setUp() {
    layout = RestoreLayout(folder.newFolder("db"), folder.newFolder("nb"))
    store = JournalStore(layout, RestoreFileOps(layout, syncDirectory = { synced += it }))
  }

  @Test
  fun theEncodingIsTheSpecsExampleShape() {
    assertEquals(
        "{\"format\":\"trezor-restore-journal\",\"version\":1,\"restoreId\":\"${"a".repeat(32)}\"," +
            "\"backupId\":\"${"b".repeat(32)}\",\"phase\":\"prepared\",\"hadDatabase\":true,\"hadAttachments\":true," +
            "\"scheduleSaved\":\"pending\",\"createdAt\":1793000000000}",
        String(journal.encode(), Charsets.UTF_8))
    for (phase in RestoreJournal.Phase.values()) {
      for (saved in RestoreJournal.Schedule.values()) {
        val j = journal.copy(phase = phase, scheduleSaved = saved, hadAttachments = phase.ordinal % 2 == 0)
        assertEquals(j, RestoreJournal.decode(j.encode()))
      }
    }
  }

  private fun expectUnknown(text: String) {
    try {
      RestoreJournal.decode(text.toByteArray(Charsets.UTF_8))
      fail("accepted: $text")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.STATE_UNKNOWN, e.code)
    }
  }

  @Test
  fun anythingElseIsStateUnknown() {
    val good = String(journal.encode(), Charsets.UTF_8)
    expectUnknown("")
    expectUnknown("not json")
    expectUnknown(good.dropLast(1))
    expectUnknown("[$good]")
    expectUnknown(good.replace("\"hadDatabase\":true", "\"hadDatabase\":false"))
    expectUnknown(good.replace("prepared", "merging"))
    expectUnknown(good.replace("pending", "maybe"))
    expectUnknown(good.replace("\"version\":1", "\"version\":2"))
    expectUnknown(good.replace("trezor-restore-journal", "other"))
    expectUnknown(good.replace("\"hadAttachments\":true", "\"hadAttachments\":\"true\""))
    expectUnknown(good.replace("a".repeat(32), "A".repeat(32)))
    expectUnknown(good.replace("b".repeat(32), "b".repeat(31)))
    expectUnknown(good.replace("1793000000000", "-1"))
    expectUnknown(good.replace("1793000000000", "1.5"))
    expectUnknown(good.replace(",\"createdAt\":1793000000000", ""))
    expectUnknown(good.replace("}", ",\"extra\":1}"))
    expectUnknown(good.replace("{", "{\"format\":\"trezor-restore-journal\","))
  }

  @Test
  fun writesGoThroughATempFileAndSyncTheDirectory() {
    store.write(journal)
    assertArrayEquals(journal.encode(), layout.journal.readBytes())
    assertFalse(layout.journalTmp.exists())
    assertEquals(listOf(layout.restoreDir), synced)
    assertEquals(journal, store.read())
    val next = journal.copy(scheduleSaved = RestoreJournal.Schedule.SAVED)
    store.write(next)
    assertEquals(next, store.read())
  }

  @Test
  fun aTempFileIsNeverAuthoritativeAndADamagedJournalIsUnknown() {
    layout.restoreDir.mkdirs()
    layout.journalTmp.writeBytes(journal.encode())
    assertNull(store.read())
    store.write(journal)
    layout.journalTmp.writeText("garbage")
    assertEquals(journal, store.read())
    layout.journal.writeText("{\"format\":")
    try {
      store.read()
      fail("damaged journal read")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.STATE_UNKNOWN, e.code)
    }
    store.delete()
    assertFalse(layout.journal.exists())
    assertFalse(layout.journalTmp.exists())
  }
}
