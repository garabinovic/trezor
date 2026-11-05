package com.trezor.app.vault

import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertArrayEquals
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
 * Envelope creation shared by every [KeyVault] in the process (audit V1, V2, L1, L4).
 * Each [EnvelopeStore] here is what one vault instance owns; [FakeMasterKeys] stands in
 * for Android Keystore, shared like the real one, and replaces its alias on generate().
 */
class EnvelopeStoreTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var keyDir: File
  private val random = SecureRandom()

  /** One process's Keystore entry for the master alias. */
  private class FakeMasterKeys : MasterKeys {
    @Volatile var key: SecretKey? = null
    val generated = AtomicInteger()
    /** Counted down by every load() that finds no key. */
    var sawNoKey = CountDownLatch(0)
    /** generate() waits here (bounded) so a second, unguarded caller can catch up. */
    var holdGenerate: CountDownLatch? = null

    override fun load(): SecretKey? = key.also { if (it == null) sawNoKey.countDown() }

    override fun generate(): SecretKey {
      holdGenerate?.await(GENERATE_WAIT_MS, TimeUnit.MILLISECONDS)
      generated.incrementAndGet()
      val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
      return SecretKeySpec(bytes, "AES").also { key = it }
    }
  }

  private val keystore = FakeMasterKeys()

  private fun store(sync: (File) -> Unit = {}) = EnvelopeStore(keyDir, keystore, sync)

  /** What KeyVault puts in an envelope, reduced to IV + AES-GCM ciphertext. */
  private fun wrap(master: SecretKey, plain: ByteArray): ByteArray {
    val iv = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, master, GCMParameterSpec(128, iv))
    return iv + cipher.doFinal(plain)
  }

  private fun unwrap(master: SecretKey, envelope: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, master, GCMParameterSpec(128, envelope, 0, 12))
    return cipher.doFinal(envelope, 12, envelope.size - 12)
  }

  private fun name(id: String) = "$id${EnvelopeStore.SUFFIX}"

  private fun expectCode(code: VaultException.Code, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: VaultException) {
      assertEquals(code, e.code)
    }
  }

  /** Runs [tasks] on threads that start together; returns what each threw, if anything. */
  private fun together(tasks: List<() -> Unit>): List<Throwable?> {
    val start = CyclicBarrier(tasks.size)
    val errors = arrayOfNulls<Throwable>(tasks.size)
    val threads =
        tasks.mapIndexed { i, task ->
          Thread {
            start.await()
            try {
              task()
            } catch (e: Throwable) {
              errors[i] = e
            }
          }
        }
    threads.forEach(Thread::start)
    threads.forEach { it.join(10_000) }
    assertTrue(threads.none(Thread::isAlive))
    return errors.toList()
  }

  @Before
  fun setUp() {
    keyDir = File(folder.root, "no_backup/keys")
    File(folder.root, "no_backup").mkdirs()
  }

  // --- V1: one master key for every instance -----------------------------------------------

  @Test
  fun instancesCreatingDifferentKeysAtOnceGenerateOneMasterKey() {
    // Without one lock for the process, a second instance would find no key while the
    // first generates (the fake holds generate() until that happens, or 500 ms).
    keystore.sawNoKey = CountDownLatch(2)
    keystore.holdGenerate = keystore.sawNoKey
    val ids = listOf("database", "attachments", "reminders", "spare")
    val plain = ids.associateWith { ByteArray(32).also(random::nextBytes) }

    val errors =
        together(ids.map { id -> { store().create(name(id)) { master -> wrap(master, plain.getValue(id)) } } })

    assertEquals(listOf<Throwable?>(null, null, null, null), errors)
    assertEquals(1, keystore.generated.get())
    // Every envelope opens with the one master key there is, from any instance.
    for (id in ids) {
      assertArrayEquals(plain.getValue(id), unwrap(keystore.key!!, store().read(name(id))!!))
    }
  }

  @Test
  fun instancesCreatingTheSameKeyAtOnceCreateItOnceAndNeverReplaceIt() {
    keystore.key = SecretKeySpec(ByteArray(32) { 1 }, "AES")
    val made = Collections.synchronizedList(mutableListOf<ByteArray>())
    val errors =
        together(
            List(6) {
              {
                store().create(name("attachments")) { master ->
                  wrap(master, ByteArray(32).also(random::nextBytes)).also { made += it }
                }
              }
            })

    assertEquals(5, errors.count { (it as? VaultException)?.code == VaultException.Code.KEY_ALREADY_EXISTS })
    assertEquals(1, made.size)
    assertArrayEquals(made.single(), store().read(name("attachments")))
    assertEquals(0, keystore.generated.get())
  }

  @Test
  fun envelopesMadeEarlierStayReadableAfterConcurrentCreates() {
    val database = ByteArray(32).also(random::nextBytes)
    store().create(name("database")) { wrap(it, database) }
    val master = keystore.key

    together(listOf("attachments", "reminders").map { id -> { store().create(name(id)) { wrap(it, ByteArray(32)) } } })

    assertTrue("the master key is never replaced", keystore.key === master)
    assertEquals(1, keystore.generated.get())
    assertArrayEquals(database, unwrap(keystore.key!!, store().read(name("database"))!!))
  }

  @Test
  fun anExistingMasterKeyIsNeverReplaced() {
    val existing = SecretKeySpec(ByteArray(32) { 3 }, "AES")
    keystore.key = existing
    store().create(name("database")) { wrap(it, ByteArray(32)) }
    store().create(name("reminders")) { wrap(it, ByteArray(32)) }
    assertEquals(0, keystore.generated.get())
    assertTrue(keystore.key === existing)
  }

  @Test
  fun aMissingMasterKeyIsNotRegeneratedOverEnvelopesOrTheirTempFiles() {
    store().create(name("database")) { wrap(it, ByteArray(32)) }
    keystore.key = null // lost (e.g. Keystore reset); its envelope remains

    expectCode(VaultException.Code.MASTER_KEY_MISSING) {
      store().create(name("reminders")) { wrap(it, ByteArray(32)) }
    }
    assertEquals(1, keystore.generated.get())

    // Only a temp file left (an envelope whose rename may never have reached the disk).
    File(keyDir, name("database")).delete()
    File(keyDir, "${name("database")}.tmp").writeText("{}")
    expectCode(VaultException.Code.MASTER_KEY_MISSING) {
      store().create(name("reminders")) { wrap(it, ByteArray(32)) }
    }
    assertEquals(1, keystore.generated.get())
  }

  // --- L1: no listing, no master key ---------------------------------------------------------

  @Test
  fun aKeyDirectoryThatCantBeListedPreventsKeyCreation() {
    keyDir.writeText("not a directory") // exists, but list() returns null
    expectCode(VaultException.Code.STORAGE_ERROR) {
      store().create(name("database")) { wrap(it, ByteArray(32)) }
    }
    assertEquals(0, keystore.generated.get())
  }

  @Test
  fun anUnreadableKeyDirectoryPreventsKeyCreation() {
    assumeFalse("root can list anything", System.getProperty("user.name") == "root")
    File(keyDir, "stray.key.json").also { it.parentFile!!.mkdirs() }.writeText("{}")
    assertTrue(keyDir.setReadable(false))
    try {
      expectCode(VaultException.Code.STORAGE_ERROR) {
        store().create(name("database")) { wrap(it, ByteArray(32)) }
      }
      assertEquals(0, keystore.generated.get())
    } finally {
      keyDir.setReadable(true)
    }
  }

  @Test
  fun aMissingKeyDirectoryWhoseParentCantBeListedPreventsKeyCreation() {
    val parent = keyDir.parentFile!!
    parent.deleteRecursively()
    parent.writeText("not a directory")
    expectCode(VaultException.Code.STORAGE_ERROR) {
      store().create(name("database")) { wrap(it, ByteArray(32)) }
    }
    assertEquals(0, keystore.generated.get())
  }

  @Test
  fun aKeyDirectoryThatIsListedButCantBeReachedPreventsKeyCreation() {
    assumeFalse("root can reach anything", System.getProperty("user.name") == "root")
    File(keyDir, name("database")).also { it.parentFile!!.mkdirs() }.writeText("{}")
    val parent = keyDir.parentFile!!
    // Readable but not searchable: the parent lists "keys", but exists() on it is false.
    assertTrue(parent.setExecutable(false))
    try {
      assertFalse(keyDir.exists())
      expectCode(VaultException.Code.STORAGE_ERROR) {
        store().create(name("reminders")) { wrap(it, ByteArray(32)) }
      }
      assertEquals(0, keystore.generated.get())
    } finally {
      parent.setExecutable(true)
    }
  }

  // --- V2, L4: durable envelopes ----------------------------------------------------------

  @Test
  fun theFirstEnvelopeSyncsTheNewDirectoryAndItsParentAfterTheRename() {
    val synced = mutableListOf<Pair<File, Boolean>>()
    val store = store { dir -> synced += dir to File(keyDir, name("database")).isFile }

    store.create(name("database")) { wrap(it, ByteArray(32)) }

    assertEquals(
        listOf(keyDir.parentFile!! to false, keyDir to true),
        synced,
    )
  }

  @Test
  fun laterEnvelopesSyncTheDirectoryOnceTheyAreInPlace() {
    store().create(name("database")) { wrap(it, ByteArray(32)) }
    val synced = mutableListOf<Pair<File, Boolean>>()
    store { dir -> synced += dir to File(keyDir, name("reminders")).isFile }
        .create(name("reminders")) { wrap(it, ByteArray(32)) }
    assertEquals(listOf(keyDir to true), synced)
  }

  @Test
  fun aFailedDirectorySyncFailsTheCallSoTheKeyIsNeverHandedOut() {
    expectCode(VaultException.Code.STORAGE_ERROR) {
      store { throw IOException("EIO") }.create(name("database")) { wrap(it, ByteArray(32)) }
    }
    keyDir.mkdirs()
    store().create(name("spare")) { wrap(it, ByteArray(32)) }
    expectCode(VaultException.Code.STORAGE_ERROR) {
      store { if (it == keyDir) throw IOException("EIO") }
          .create(name("reminders")) { wrap(it, ByteArray(32)) }
    }
  }

  @Test
  fun eachWriteUsesItsOwnTempFileAndLeavesLeftoversAlone() {
    // A temp file from an earlier crash, under the old fixed name: possibly the only copy
    // of an envelope. A new write must neither reuse, truncate nor delete it.
    keystore.key = SecretKeySpec(ByteArray(32) { 4 }, "AES")
    keyDir.mkdirs()
    val leftover = File(keyDir, "${name("attachments")}.tmp").also { it.writeText("earlier envelope") }

    store().create(name("attachments")) { wrap(it, ByteArray(32)) }
    store().create(name("reminders")) { wrap(it, ByteArray(32)) }

    assertEquals("earlier envelope", leftover.readText())
    val names = keyDir.list()!!.sorted()
    assertEquals(listOf(name("attachments"), leftover.name, name("reminders")), names)
  }

  @Test
  fun aWriteThatFailsReportsStorageErrorAndTouchesNoOtherFile() {
    assumeFalse("root can write anywhere", System.getProperty("user.name") == "root")
    keystore.key = SecretKeySpec(ByteArray(32) { 5 }, "AES")
    keyDir.mkdirs()
    val leftover = File(keyDir, "${name("database")}.tmp").also { it.writeText("earlier") }
    assertTrue(keyDir.setWritable(false))
    try {
      expectCode(VaultException.Code.STORAGE_ERROR) {
        store().create(name("reminders")) { wrap(it, ByteArray(32)) }
      }
    } finally {
      keyDir.setWritable(true)
    }
    assertEquals(listOf(leftover.name), keyDir.list()!!.toList())
    assertEquals("earlier", leftover.readText())
  }

  companion object {
    private const val GENERATE_WAIT_MS = 500L
  }
}
