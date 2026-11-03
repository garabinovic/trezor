package com.trezor.app.attachments

import com.trezor.app.attachments.AttachmentStore.StoreException.Code
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AttachmentStoreTest {

  @Test
  fun hasAnyFileNeverGuessesNoWhenTheDirectoryCantBeRead() {
    assertFalse(store.hasAnyFile()) // no directory yet: a fresh install
    store.import(a, ByteArrayInputStream(bytes(10)), 1000)
    assertTrue(store.hasAnyFile())

    // The store path exists but is not a directory.
    val notADir = File(folder.root, "file-instead")
    notADir.writeBytes(byteArrayOf(1))
    try {
      AttachmentStore(notADir) { keyBytes.copyOf() }.hasAnyFile()
      fail("must fail closed")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(Code.IO_FAILED, e.code)
    }

    // A directory that can't be listed (skipped where permissions don't apply, e.g. root).
    assertTrue(root.setReadable(false))
    try {
      if (!root.canRead()) {
        try {
          store.hasAnyFile()
          fail("must fail closed")
        } catch (e: AttachmentStore.StoreException) {
          assertEquals(Code.IO_FAILED, e.code)
        }
      }
    } finally {
      root.setReadable(true)
    }
  }


  @get:Rule val folder = TemporaryFolder()

  private lateinit var root: File
  private val handedOut = mutableListOf<ByteArray>()
  private val keyBytes = ByteArray(32) { (it * 7).toByte() }
  private lateinit var store: AttachmentStore

  private val a = "01a1a0dd-991f-783c-9531-3fab9ef47901"
  private val b = "01a1a0dd-991f-783c-9531-3fab9ef47902"
  private val c = "01a1a0dd-991f-783c-9531-3fab9ef47903"

  @Before
  fun setUp() {
    root = File(folder.root, "attachments")
    store = AttachmentStore(root) { keyBytes.copyOf().also(handedOut::add) }
  }

  private fun bytes(size: Int, seed: Long = 1) = ByteArray(size).also { Random(seed).nextBytes(it) }

  private fun read(id: String, s: AttachmentStore = store) =
      ByteArrayOutputStream().also { s.decryptTo(id, it) }.toByteArray()

  private fun expect(code: Code, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(code, e.code)
    }
  }

  private fun leftovers() = File(root, "tmp").listFiles()?.toList().orEmpty()

  @Test
  fun importStoresAnEncryptedVerifiedFileAndReadsItBack() {
    val plain = "receipt ".repeat(50_000).toByteArray()
    val result = store.import(a, ByteArrayInputStream(plain), 25L * 1024 * 1024)
    assertEquals(plain.size.toLong(), result.sizeBytes)
    assertTrue(store.exists(a))
    assertEquals(setOf(a), store.storedIds())
    assertTrue(leftovers().isEmpty())
    val onDisk = File(root, "$a.tza").readBytes()
    assertFalse(String(onDisk, Charsets.ISO_8859_1).contains("receipt"))
    assertArrayEquals(plain, read(a))
    store.verify(a, result.sizeBytes, result.sha256)
    // Every key handed out was zeroed after use.
    assertTrue(handedOut.isNotEmpty())
    assertTrue(handedOut.all { k -> k.all { it == 0.toByte() } })
  }

  @Test
  fun anExistingAttachmentIsNeverOverwritten() {
    store.import(a, ByteArrayInputStream(bytes(100, 1)), 1000)
    expect(Code.ALREADY_EXISTS) { store.import(a, ByteArrayInputStream(bytes(100, 2)), 1000) }
    assertArrayEquals(bytes(100, 1), read(a))
  }

  @Test
  fun failedImportsLeaveNothingBehind() {
    expect(Code.TOO_LARGE) { store.import(a, ByteArrayInputStream(bytes(2000)), 1000) }
    val failing =
        object : InputStream() {
          var served = 0
          override fun read(): Int = throw UnsupportedOperationException()
          override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (served > 100_000) throw IOException("source went away")
            served += len
            return len
          }
        }
    expect(Code.IO_FAILED) { store.import(b, failing, 1_000_000) }
    assertFalse(store.exists(a))
    assertFalse(store.exists(b))
    assertTrue(leftovers().isEmpty())
  }

  @Test
  fun idsAreValidatedAgainstPathTraversal() {
    for (bad in listOf("../keys/database", "01A1A0DD-991F-783C-9531-3FAB9EF47901", "", "x.tza")) {
      expect(Code.INVALID_ID) { store.import(bad, ByteArrayInputStream(ByteArray(1)), 10) }
      expect(Code.INVALID_ID) { store.delete(bad) }
    }
  }

  @Test
  fun missingDamagedAndMismatchedFilesAreReportedAndDontAffectOthers() {
    val ra = store.import(a, ByteArrayInputStream(bytes(5000, 1)), 10_000)
    store.import(b, ByteArrayInputStream(bytes(5000, 2)), 10_000)
    expect(Code.MISSING) { read(c) }

    val fileA = File(root, "$a.tza")
    fileA.writeBytes(fileA.readBytes().also { it[it.size - 3] = (it[it.size - 3].toInt() xor 0xff).toByte() })
    expect(Code.CORRUPTED) { read(a) }
    File(root, "$b.tza").copyTo(File(root, "$c.tza")) // b's file under another id
    expect(Code.KEY_MISMATCH) { read(c) }
    expect(Code.INTEGRITY_MISMATCH) { store.verify(b, ra.sizeBytes + 1, null) }
    expect(Code.INTEGRITY_MISMATCH) { store.verify(b, null, ra.sha256) }

    assertArrayEquals(bytes(5000, 2), read(b))
  }

  @Test
  fun aDifferentKeyCannotReadTheFiles() {
    store.import(a, ByteArrayInputStream(bytes(10)), 100)
    val other = AttachmentStore(root) { ByteArray(32) { 9 } }
    expect(Code.KEY_MISMATCH) { read(a, other) }
  }

  @Test
  fun deletingIsIdempotentAndOnlyTouchesItsOwnFile() {
    store.import(a, ByteArrayInputStream(bytes(10, 1)), 100)
    store.import(b, ByteArrayInputStream(bytes(10, 2)), 100)
    assertTrue(store.delete(a))
    assertFalse(store.delete(a))
    assertFalse(store.exists(a))
    assertArrayEquals(bytes(10, 2), read(b))
  }

  @Test
  fun garbageCollectionRemovesOrphansAndInterruptedImportsOnly() {
    store.import(a, ByteArrayInputStream(bytes(10, 1)), 100)
    store.import(b, ByteArrayInputStream(bytes(10, 2)), 100)
    // A crash during an earlier import, and an unrelated file.
    File(root, "tmp/$c.part").writeBytes(bytes(50))
    File(root, "notes.txt").writeText("not ours")

    assertEquals(2, store.collectGarbage(setOf(a))) // b's file (orphan) and c's part
    assertEquals(setOf(a), store.storedIds())
    assertTrue(leftovers().isEmpty())
    assertTrue(File(root, "notes.txt").isFile)
    assertArrayEquals(bytes(10, 1), read(a))
    assertEquals(0, store.collectGarbage(setOf(a)))
  }

  @Test
  fun anEmptyRootIsFine() {
    assertEquals(emptySet<String>(), store.storedIds())
    assertEquals(0, store.collectGarbage(emptySet()))
  }
}
