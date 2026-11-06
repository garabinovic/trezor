package com.trezor.app.attachments

import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Startup cleanup: once per process (review M2), never over a new database's files (M1). */
class AttachmentCleanupTest {

  @get:Rule val folder = TemporaryFolder()

  private val key = ByteArray(32) { 8 }
  private lateinit var root: File
  private lateinit var store: AttachmentStore
  private lateinit var views: AttachmentViews
  private lateinit var shares: ShareFiles
  private var clock = 1_800_000_000_000L

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef479%02d".format(n)

  private fun stored(n: Int): String =
      id(n).also { store.import(it, ByteArrayInputStream(ByteArray(1_000) { n.toByte() }), 1L shl 20) }

  /** A cleanup as one process sees it; new [AtomicBoolean]s are a new process. */
  private fun process(
      done: AtomicBoolean = AtomicBoolean(false),
      viewsDone: AtomicBoolean = AtomicBoolean(false),
  ) = AttachmentCleanup(store, views, shares, done, viewsDone)

  private val viewDir get() = File(folder.root, "cache/attachments/view")

  /** A decrypted copy an earlier (killed) process left behind. */
  private fun leftoverView(name: String = "ab".repeat(16)) =
      File(viewDir, "$name.view").also {
        it.parentFile!!.mkdirs()
        it.writeText("plaintext")
      }

  @Before
  fun setUp() {
    root = File(folder.root, "files/attachments")
    store = AttachmentStore(root) { key.copyOf() }
    views = AttachmentViews(store, File(folder.root, "cache/attachments/view"))
    shares = ShareFiles(store, File(folder.root, "cache/attachments/share"), now = { clock })
  }

  @Test
  fun aNormalStartupRemovesOrphansViewsAndUnfinishedImportsOnly() {
    val kept = stored(1)
    val orphan = stored(2)
    val view = views.open(kept, 1_000, store.verify(kept).sha256)
    File(root, "tmp").mkdirs()
    File(root, "tmp/${id(3)}.part").writeText("x")

    assertEquals(2, process().atStartup(setOf(kept)))

    assertEquals(setOf(kept), store.storedIds())
    assertTrue(!view.exists())
    assertTrue(File(root, "tmp").listFiles().orEmpty().isEmpty())
    assertTrue(orphan !in store.storedIds())
  }

  // --- M2 -------------------------------------------------------------------------------

  @Test
  fun m2_aSecondReactRootInTheSameProcessRemovesNothing() {
    val known = stored(1)
    val done = AtomicBoolean(false)
    assertEquals(0, process(done).atStartup(setOf(known)))

    // The first tree imports a file and hasn't saved its row yet when the Activity is
    // recreated: the new root's database (and so its id list) doesn't have it.
    val unsaved = stored(2)
    val view = views.open(known, 1_000, store.verify(known).sha256)
    assertNull(process(done).atStartup(setOf(known)))

    assertEquals(setOf(known, unsaved), store.storedIds())
    assertTrue("open views of the first tree are kept", view.exists())
  }

  @Test
  fun m2_expiredSharesArePurgedOnEveryCallActiveOnesNever() {
    val known = stored(1)
    val sha = store.verify(known).sha256
    val done = AtomicBoolean(false)
    process(done).atStartup(setOf(known))
    val old = shares.prepare(known, 1_000, sha, "old.pdf", MediaTypes.PDF).also(shares::release)
    val active = shares.prepare(known, 1_000, sha, "active.pdf", MediaTypes.PDF)
    clock += ShareFiles.RETENTION_MS + 1

    assertNull(process(done).atStartup(setOf(known)))

    assertTrue(!old.exists())
    assertTrue(active.exists())
  }

  @Test
  fun m2_concurrentStartupsRunTheCleanupExactlyOnce() {
    stored(1)
    val done = AtomicBoolean(false)
    val ran = AtomicInteger()
    val start = CountDownLatch(1)
    val threads =
        (0 until 8).map {
          Thread {
            start.await()
            if (process(done).atStartup(emptySet()) != null) ran.incrementAndGet()
          }
        }
    threads.forEach(Thread::start)
    start.countDown()
    threads.forEach { it.join(5_000) }
    assertEquals(1, ran.get())
  }

  @Test
  fun m2_aFailedCleanupIsNotRetriedByALaterRootOfTheSameProcess() {
    root.mkdirs()
    File(root, AttachmentStore.KEPT_NAME).writeText("damaged")
    val done = AtomicBoolean(false)
    try {
      process(done).atStartup(emptySet())
      fail("a damaged record must fail the cleanup")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
    }
    val later = stored(1)
    assertNull(process(done).atStartup(emptySet()))
    assertEquals(setOf(later), store.storedIds())
  }

  // --- M1 -------------------------------------------------------------------------------

  @Test
  fun m1_filesThatExistWhenTheDatabaseIsCreatedAreNeverCollected() {
    // The database file went missing; its attachment files and key are still there.
    val a = stored(1)
    val b = stored(2)
    assertEquals(2, process().beforeDatabaseCreated())

    // The same launch (the new database has no rows) and every later launch, also after
    // the user added items to the new database.
    process().atStartup(emptySet())
    assertEquals(setOf(a, b), store.storedIds())
    val added = stored(3)
    val orphan = stored(4)
    process().atStartup(setOf(added))
    assertEquals(setOf(a, b, added), store.storedIds())
    assertTrue(orphan !in store.storedIds())
    assertEquals(setOf(a, b), store.keptIds())
  }

  @Test
  fun m1_theKeptRecordIsWrittenAndSyncedBeforeItReturns() {
    val synced = mutableListOf<File>()
    store = AttachmentStore(root, syncDirectory = { synced += it }) { key.copyOf() }
    val a = stored(1)
    synced.clear()

    process().beforeDatabaseCreated()

    assertEquals(listOf(root), synced)
    assertEquals(setOf(a), AttachmentStore(root) { key.copyOf() }.keptIds())
    assertTrue(File(root, "tmp").listFiles().orEmpty().none { it.name.startsWith(AttachmentStore.KEPT_NAME) })
  }

  @Test
  fun m1_aGenuineFirstLaunchWritesNothing() {
    assertEquals(0, process().beforeDatabaseCreated())
    assertTrue(!File(root, AttachmentStore.KEPT_NAME).exists())
  }

  @Test
  fun m1_theRecordOnlyGrows() {
    val a = stored(1)
    process().beforeDatabaseCreated()
    val b = stored(2)
    assertEquals(2, process().beforeDatabaseCreated())
    assertEquals(setOf(a, b), store.keptIds())
  }

  @Test
  fun m1_aFailedSyncFailsTheCallSoTheDatabaseIsNotCreated() {
    store = AttachmentStore(root, syncDirectory = { throw java.io.IOException("EIO") }) { key.copyOf() }
    // Import itself syncs too; write the file with a working store.
    AttachmentStore(root) { key.copyOf() }.import(id(1), ByteArrayInputStream(ByteArray(10)), 1L shl 20)
    try {
      process().beforeDatabaseCreated()
      fail("a record that isn't durable must not be reported as kept")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
    }
  }

  @Test
  fun m1_aStoreThatCantBeListedFailsTheCallInsteadOfKeepingNothing() {
    // Not a directory: listing fails, so "no files" can't be concluded.
    root.parentFile!!.mkdirs()
    root.writeText("not a directory")
    try {
      process().beforeDatabaseCreated()
      fail("an unlistable store must fail closed")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
    }
  }

  @Test
  fun m1_aDamagedRecordFailsClosedAndDeletesNoAttachmentFile() {
    val a = stored(1)
    File(root, "tmp").mkdirs()
    File(root, "tmp/${id(9)}.part").writeText("x")
    for (damage in listOf("not a record\n", "trezor.kept-attachments|1\n../../etc\n", "")) {
      File(root, AttachmentStore.KEPT_NAME).writeText(damage)
      try {
        process().atStartup(emptySet())
        fail("'$damage' must fail the cleanup")
      } catch (e: AttachmentStore.StoreException) {
        assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
      }
      assertEquals(setOf(a), store.storedIds())
    }
    assertTrue("unfinished imports still go", File(root, "tmp").listFiles().orEmpty().isEmpty())
  }

  @Test
  fun m1_keptFilesStillCountForTheKeyRule() {
    stored(1)
    process().beforeDatabaseCreated()
    // AttachmentKeys must never create a new key while these files exist.
    assertTrue(store.hasAnyFile())
  }

  // --- L2: decrypted views go at module start, without the database ----------------------

  @Test
  fun l2_viewsOfAnEarlierProcessAreRemovedAtModuleStart() {
    val whole = leftoverView()
    val page = leftoverView("cd".repeat(16))
    val part = File(viewDir, "${"ef".repeat(16)}.view.part").also { it.writeText("partial") }

    assertEquals(3, process().atModuleStart())

    assertTrue(!whole.exists() && !page.exists() && !part.exists())
  }

  @Test
  fun l2_itNeedsNoDatabaseNorKey() {
    // The database can't be opened and the key is unavailable: nothing here asks for them.
    val tza = stored(1)
    val leftover = leftoverView()
    val noKey = AttachmentStore(root) { throw IllegalStateException("no key") }
    val cleanup =
        AttachmentCleanup(noKey, AttachmentViews(noKey, viewDir), shares, AtomicBoolean(false), AtomicBoolean(false))

    assertEquals(1, cleanup.atModuleStart())

    assertTrue(!leftover.exists())
    assertEquals(setOf(tza), store.storedIds())
  }

  @Test
  fun l2_encryptedFilesSharesAndOpenViewsAreKept() {
    val a = stored(1)
    val sha = store.verify(a).sha256
    val active = shares.prepare(a, 1_000, sha, "active.pdf", MediaTypes.PDF)
    val recent = shares.prepare(a, 1_000, sha, "recent.pdf", MediaTypes.PDF).also(shares::release)
    val open = views.open(a, 1_000, sha)
    val page = views.newFile().also { it.writeBytes(byteArrayOf(1)) }
    val leftover = leftoverView()
    val tzaBytes = File(root, "$a${AttachmentStore.SUFFIX}").readBytes()

    assertEquals(1, process().atModuleStart())

    assertTrue(!leftover.exists())
    assertTrue("files this process handed out stay", open.exists() && page.exists())
    assertTrue(active.exists() && recent.exists())
    assertArrayEquals(tzaBytes, File(root, "$a${AttachmentStore.SUFFIX}").readBytes())
  }

  @Test
  fun l2_aViewBeingCreatedAtTheSameTimeIsNotLost() {
    val a = stored(1)
    val sha = store.verify(a).sha256
    leftoverView()
    // The open is held while it decrypts into its .part file.
    val decrypting = CountDownLatch(1)
    val finish = CountDownLatch(1)
    val slowStore =
        AttachmentStore(root) {
          decrypting.countDown()
          finish.await()
          key.copyOf()
        }
    val shared = AttachmentViews(slowStore, viewDir)
    var opened: File? = null
    val viewer = Thread { opened = shared.open(a, 1_000, sha) }
    viewer.start()
    assertTrue(decrypting.await(5, java.util.concurrent.TimeUnit.SECONDS))
    val part = viewDir.listFiles()!!.single { it.name.endsWith(".part") }

    val cleanup = AttachmentCleanup(slowStore, shared, shares, AtomicBoolean(false), AtomicBoolean(false))
    assertEquals(1, cleanup.atModuleStart())
    assertTrue("the open's partial copy stays", part.exists())

    finish.countDown()
    viewer.join(5_000)
    assertTrue(opened!!.exists())
    assertEquals(1_000L, opened!!.length())
  }

  @Test
  fun l2_aCacheDirectoryThatCantBeListedRemovesNothing() {
    assumeFalse("root can list anything", System.getProperty("user.name") == "root")
    val a = stored(1)
    val leftover = leftoverView()
    val share = shares.prepare(a, 1_000, store.verify(a).sha256, "s.pdf", MediaTypes.PDF)
    assertTrue(viewDir.setReadable(false))
    try {
      assertEquals(0, process().atModuleStart())
    } finally {
      viewDir.setReadable(true)
    }
    assertTrue(leftover.exists() && share.exists())
    assertEquals(setOf(a), store.storedIds())

    // Not a directory at all: nothing to list, nothing removed, no exception.
    viewDir.deleteRecursively()
    viewDir.writeText("not a directory")
    assertEquals(0, process().atModuleStart())
    assertTrue(viewDir.isFile)
  }

  @Test
  fun d_expiredSharesOfAnEarlierProcessAreRemovedAtModuleStartActiveAndRecentOnesKept() {
    val a = stored(1)
    val sha = store.verify(a).sha256
    // Left by an earlier process more than 24 hours ago.
    val old = shares.prepare(a, 1_000, sha, "old.pdf", MediaTypes.PDF).also(shares::release)
    clock += ShareFiles.RETENTION_MS + 1
    val recent = shares.prepare(a, 1_000, sha, "recent.pdf", MediaTypes.PDF).also(shares::release)
    val active = shares.prepare(a, 1_000, sha, "active.pdf", MediaTypes.PDF)
    val tzaBytes = File(root, "$a${AttachmentStore.SUFFIX}").readBytes()

    // No view left over, one expired share: one file removed, and no database needed.
    assertEquals(1, process().atModuleStart())

    assertTrue(!old.exists())
    assertTrue(recent.exists() && active.exists())
    assertArrayEquals(tzaBytes, File(root, "$a${AttachmentStore.SUFFIX}").readBytes())
  }

  @Test
  fun d_aShareDirectoryThatCantBeListedRemovesNothingAndViewsStillGo() {
    assumeFalse("root can list anything", System.getProperty("user.name") == "root")
    val a = stored(1)
    val old = shares.prepare(a, 1_000, store.verify(a).sha256, "old.pdf", MediaTypes.PDF).also(shares::release)
    clock += ShareFiles.RETENTION_MS + 1
    val leftover = leftoverView()
    val shareDir = File(folder.root, "cache/attachments/share")
    assertTrue(shareDir.setReadable(false))
    try {
      assertEquals(1, process().atModuleStart())
    } finally {
      shareDir.setReadable(true)
    }
    assertTrue(!leftover.exists())
    assertTrue(old.exists())
  }

  @Test
  fun l2_itRunsOncePerProcess() {
    val viewsDone = AtomicBoolean(false)
    leftoverView()
    assertEquals(1, process(viewsDone = viewsDone).atModuleStart())
    val later = leftoverView("cd".repeat(16))
    // A second module instance (a React reload) in the same process removes nothing.
    assertNull(process(viewsDone = viewsDone).atModuleStart())
    assertTrue(later.exists())
  }
}
