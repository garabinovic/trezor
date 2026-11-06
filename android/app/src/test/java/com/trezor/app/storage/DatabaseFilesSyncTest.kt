package com.trezor.app.storage

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Durability of [DatabaseFiles.renameNoReplace] (snapshot temp → final name): the database
 * directory is synced after the rename, and only then is success reported.
 */
class DatabaseFilesSyncTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var dir: File
  /** Each sync: the directory, and whether the renamed target existed at that moment. */
  private val synced = mutableListOf<Pair<File, Boolean>>()
  private var syncFailure: Exception? = null

  private val temp = "trezor.pre-migration-v3.0a1b2c3d4e5f.partial.db"
  private val final = "trezor.pre-migration-v3.db"

  private fun files() =
      DatabaseFiles(dir) { d ->
        synced += d to File(dir, final).exists()
        syncFailure?.let { throw it }
      }

  private fun write(name: String, text: String = "snapshot") =
      File(dir, name).also { it.writeText(text) }

  private fun expectIOException(block: () -> Unit): IOException {
    try {
      block()
    } catch (e: IOException) {
      return e
    }
    fail("expected IOException")
    throw AssertionError()
  }

  @Before
  fun setUp() {
    dir = folder.newFolder("databases")
  }

  @Test
  fun aRenameSyncsTheDatabaseDirectoryOnceTheNewNameExists() {
    write(temp, "verified copy")

    files().renameNoReplace(temp, final)

    // The directory (not the file), after the rename.
    assertEquals(listOf(dir to true), synced)
    assertFalse(File(dir, temp).exists())
    assertEquals("verified copy", File(dir, final).readText())
  }

  @Test
  fun aFailedSyncIsReportedAndTheRenamedFileStaysInPlace() {
    write(temp, "verified copy")
    val cause = IOException("EIO")
    syncFailure = cause

    val e = expectIOException { files().renameNoReplace(temp, final) }

    assertTrue(e.cause === cause)
    // Not reported as done, but nothing is deleted either: a retry finds the snapshot.
    assertEquals("verified copy", File(dir, final).readText())
    assertFalse(File(dir, temp).exists())
  }

  @Test
  fun aSyncThatFailsWithAnotherExceptionIsReportedAsIOException() {
    write(temp)
    val cause = UnsupportedOperationException("no fsync")
    syncFailure = cause
    val e = expectIOException { files().renameNoReplace(temp, final) }
    assertTrue(e.cause === cause)
  }

  @Test
  fun anExistingTargetIsNeverReplacedAndNothingIsSynced() {
    write(temp, "new")
    write(final, "existing")

    expectIOException { files().renameNoReplace(temp, final) }

    assertEquals("existing", File(dir, final).readText())
    assertEquals("new", File(dir, temp).readText())
    assertEquals(emptyList<Pair<File, Boolean>>(), synced)
  }

  @Test
  fun aMissingSourceIsAnErrorAndNothingIsSynced() {
    expectIOException { files().renameNoReplace(temp, final) }
    assertFalse(File(dir, final).exists())
    assertEquals(emptyList<Pair<File, Boolean>>(), synced)
  }

  @Test
  fun aRenameTheFileSystemRefusesIsNotReportedAsDoneAndNothingIsSynced() {
    assumeFalse("root can write anywhere", System.getProperty("user.name") == "root")
    write(temp, "copy")
    assertTrue(dir.setWritable(false))
    try {
      expectIOException { files().renameNoReplace(temp, final) }
    } finally {
      dir.setWritable(true)
    }
    assertEquals("copy", File(dir, temp).readText())
    assertFalse(File(dir, final).exists())
    assertEquals(emptyList<Pair<File, Boolean>>(), synced)
  }

  @Test
  fun pathsAreStillRejectedBeforeAnything() {
    for ((from, to) in listOf("../x.db" to final, temp to "../x.db", "a/b.db" to final)) {
      try {
        files().renameNoReplace(from, to)
        fail("must refuse $from -> $to")
      } catch (e: IllegalArgumentException) {
        // expected
      }
    }
    assertEquals(emptyList<Pair<File, Boolean>>(), synced)
  }

  @Test
  fun deletingATemporaryFileDoesNotSyncAndStillRefusesRealFiles() {
    write(temp)
    write("$temp-journal")
    write(final, "real snapshot")

    files().deleteTemporary(temp)

    assertFalse(File(dir, temp).exists())
    assertFalse(File(dir, "$temp-journal").exists())
    assertEquals(emptyList<Pair<File, Boolean>>(), synced)
    try {
      files().deleteTemporary(final)
      fail("a real snapshot must never be deleted here")
    } catch (e: IllegalArgumentException) {
      // expected
    }
    assertEquals("real snapshot", File(dir, final).readText())
  }

  @Test
  fun theDefaultSyncWorksOnTheHostFileSystem() {
    write(temp)
    // DirectorySync's JVM path (FileChannel.force on the directory) must not throw.
    DatabaseFiles(dir).renameNoReplace(temp, final)
    assertTrue(File(dir, final).exists())
  }
}
