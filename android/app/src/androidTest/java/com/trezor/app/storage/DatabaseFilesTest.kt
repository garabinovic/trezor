package com.trezor.app.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DatabaseFilesTest {

  private lateinit var root: File
  private lateinit var dir: File
  private lateinit var files: DatabaseFiles

  @Before
  fun setUp() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    root = File(context.cacheDir, "dbfiles-test").apply { deleteRecursively() }
    dir = File(root, "databases")
    files = DatabaseFiles(dir)
  }

  @After
  fun tearDown() {
    root.deleteRecursively()
  }

  @Test
  fun missingDirectoryMeansAbsent() {
    root.mkdirs()
    assertEquals(DatabaseFiles.State.ABSENT, files.state("trezor.db"))
  }

  @Test
  fun reportsPresentAndAbsent() {
    dir.mkdirs()
    assertEquals(DatabaseFiles.State.ABSENT, files.state("trezor.db"))
    File(dir, "trezor.db").writeText("x")
    assertEquals(DatabaseFiles.State.PRESENT, files.state("trezor.db"))
  }

  @Test
  fun unreadableLocationIsAnErrorNotAbsent() {
    // The "database directory" is a regular file, so it cannot be listed.
    root.mkdirs()
    dir.writeText("not a directory")
    expectIOException { files.state("trezor.db") }
  }

  @Test
  fun directoryWithSameNameAsDatabaseIsAnError() {
    File(dir, "trezor.db").mkdirs()
    expectIOException { files.state("trezor.db") }
  }

  @Test
  fun renameNeverReplacesExistingTarget() {
    dir.mkdirs()
    File(dir, "a.partial.db").writeText("new")
    File(dir, "a.db").writeText("verified")
    expectIOException { files.renameNoReplace("a.partial.db", "a.db") }
    assertEquals("verified", File(dir, "a.db").readText())
    assertTrue(File(dir, "a.partial.db").exists())
  }

  @Test
  fun renameMovesFile() {
    dir.mkdirs()
    File(dir, "a.partial.db").writeText("data")
    files.renameNoReplace("a.partial.db", "a.db")
    assertEquals("data", File(dir, "a.db").readText())
    assertFalse(File(dir, "a.partial.db").exists())
  }

  @Test
  fun deleteTemporaryRemovesFileAndSideFiles() {
    dir.mkdirs()
    for (suffix in listOf("", "-journal", "-wal", "-shm")) {
      File(dir, "s.v1.abc.partial.db$suffix").writeText("x")
    }
    files.deleteTemporary("s.v1.abc.partial.db")
    assertEquals(0, dir.list()!!.size)
  }

  @Test
  fun deleteTemporaryRefusesRealDatabasesAndSnapshots() {
    dir.mkdirs()
    for (name in listOf("trezor.db", "trezor.pre-migration-v1.db")) {
      File(dir, name).writeText("keep")
      try {
        files.deleteTemporary(name)
        fail("Expected refusal for $name")
      } catch (e: IllegalArgumentException) {
        // expected
      }
      assertTrue(File(dir, name).exists())
    }
  }

  @Test
  fun pathsAreRejected() {
    for (name in listOf("../x.db", "a/b.db", "x.txt", "")) {
      try {
        files.state(name)
        fail("Expected rejection for '$name'")
      } catch (e: IllegalArgumentException) {
        // expected
      }
    }
  }

  private fun expectIOException(block: () -> Unit) {
    try {
      block()
      fail("Expected IOException")
    } catch (e: IOException) {
      // expected
    }
  }
}
