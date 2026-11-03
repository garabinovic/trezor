package com.trezor.app.attachments

import java.io.ByteArrayInputStream
import java.io.File
import java.util.Random
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.w3c.dom.Element

class ShareFilesTest {

  @get:Rule val folder = TemporaryFolder()

  private val hour = 60L * 60 * 1000
  private var clock = 1_800_000_000_000L
  private lateinit var store: AttachmentStore
  private lateinit var dir: File
  private lateinit var shares: ShareFiles
  private val id = "01a1a0dd-991f-783c-9531-3fab9ef47901"
  private val content = "%PDF-1.4\n".toByteArray() + ByteArray(90_000).also { Random(3).nextBytes(it) }
  private lateinit var record: AttachmentFormat.Result

  @Before
  fun setUp() {
    val key = ByteArray(32) { 6 }
    store = AttachmentStore(File(folder.root, "files/attachments")) { key.copyOf() }
    dir = File(folder.root, "cache/attachments/share")
    shares = ShareFiles(store, dir, now = { clock })
    record = store.import(id, ByteArrayInputStream(content), 1L shl 30)
  }

  private fun prepare(name: String = "Receipt March.pdf") =
      shares.prepare(id, record.sizeBytes, record.sha256, name, MediaTypes.PDF)

  @Test
  fun aShareFileIsACheckedCopyInItsOwnFolderUnderTheShareCache() {
    val file = prepare()
    assertArrayEquals(content, file.readBytes())
    assertEquals("Receipt March.pdf", file.name)
    assertEquals(dir.canonicalPath, file.parentFile!!.parentFile!!.canonicalPath)
    assertTrue(file.parentFile!!.name.matches(Regex("^[0-9a-f]{32}$")))
    assertEquals(listOf(file.name), file.parentFile!!.list()!!.toList())
    // A stored name can't leave the folder, and gets its extension.
    val odd = prepare("../../files/attachments/notes")
    assertEquals("notes.pdf", odd.name)
    assertEquals(dir.canonicalPath, odd.parentFile!!.parentFile!!.canonicalPath)
  }

  @Test
  fun aDamagedOrMissingAttachmentLeavesNothingToShare() {
    try {
      shares.prepare(id, record.sizeBytes, "0".repeat(64), "x.pdf", MediaTypes.PDF)
      fail("expected an integrity failure")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.INTEGRITY_MISMATCH, e.code)
    }
    store.delete(id)
    try {
      prepare()
      fail("expected a missing file")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.MISSING, e.code)
    }
    assertTrue(dir.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun filesAreKeptFor24HoursThenRemoved() {
    val file = prepare()
    shares.release(file)

    clock += 23 * hour
    assertEquals(0, shares.purgeExpired())
    assertTrue(file.exists())

    clock += 2 * hour
    assertEquals(1, shares.purgeExpired())
    assertFalse(file.parentFile!!.exists())
  }

  @Test
  fun aShareInProgressIsNeverRemovedEvenIfItLooksOld() {
    val file = prepare()
    // e.g. the clock moved forward while the share sheet was being opened.
    clock += 48 * hour
    assertEquals(0, shares.purgeExpired())
    assertTrue(file.exists())

    shares.release(file)
    assertEquals(1, shares.purgeExpired())
    assertFalse(file.exists())
  }

  @Test
  fun leftoversFromEarlierRunsAreRemovedWhenExpired() {
    val recent = File(dir, "aa".repeat(16)).also { it.mkdirs() }
    File(recent, "a.pdf").also { it.writeBytes(byteArrayOf(1)); it.setLastModified(clock - hour) }
    recent.setLastModified(clock - hour)
    val old = File(dir, "bb".repeat(16)).also { it.mkdirs() }
    File(old, ".part").also { it.writeBytes(byteArrayOf(1)); it.setLastModified(clock - 30 * hour) }
    old.setLastModified(clock - 30 * hour)

    assertEquals(1, shares.purgeExpired())
    assertTrue(recent.exists())
    assertFalse(old.exists())
    assertTrue(store.exists(id))
  }

  private class NoReceiver : Exception("no app")

  @Test
  fun aSuccessfulLaunchKeepsTheCopyForTheRetentionPeriod() {
    val file = prepare()
    var launched: String? = null
    shares.launch(file, uriFor = { "content://x/${it.name}" }, start = { launched = it })
    assertEquals("content://x/Receipt March.pdf", launched)
    assertTrue(file.exists())
    clock += 23 * hour
    assertEquals(0, shares.purgeExpired())
    clock += 2 * hour
    assertEquals(1, shares.purgeExpired())
  }

  @Test
  fun everyFailedLaunchDeletesTheCopyAtOnceAndKeepsTheError() {
    val failures: List<Pair<Class<out Throwable>, (File) -> Unit>> =
        listOf(
            // No URI (e.g. FileProvider misconfigured).
            IllegalArgumentException::class.java to { f -> shares.launch(f, uriFor = { throw IllegalArgumentException("uri") }, start = {}) },
            // No foreground activity.
            IllegalStateException::class.java to { f -> shares.launch(f, uriFor = { "u" }, start = { throw IllegalStateException("activity") }) },
            // No app can receive it (ActivityNotFoundException on a device).
            NoReceiver::class.java to { f -> shares.launch(f, uriFor = { "u" }, start = { throw NoReceiver() }) },
        )
    val other = prepare("Other.pdf") // another share being prepared at the same time
    for ((expected, launch) in failures) {
      val name = expected.simpleName
      val file = prepare()
      val thrown =
          try {
            launch(file)
            null
          } catch (e: Throwable) {
            e
          }
      // The launch's own error comes through, not a cleanup error.
      assertEquals(name, expected, thrown?.javaClass)
      assertFalse(name, file.parentFile!!.exists())
    }
    assertTrue(other.exists())
    assertEquals(listOf(other.parentFile!!.name), dir.list()!!.toList())
    // Still active, so not purged even when old.
    clock += 48 * hour
    assertEquals(0, shares.purgeExpired())
  }

  @Test
  fun aFailingCleanupNeverHidesTheLaunchError() {
    val stubborn = ShareFiles(store, dir, { clock }) { throw SecurityException("can't delete") }
    val file = stubborn.prepare(id, record.sizeBytes, record.sha256, "a.pdf", MediaTypes.PDF)
    try {
      stubborn.launch(file, uriFor = { "u" }, start = { throw NoReceiver() })
      fail("expected the launch failure")
    } catch (e: NoReceiver) {
      // The original error, not the cleanup's.
    }
    // Left for the normal expiry cleanup.
    clock += 25 * hour
    assertEquals(1, shares.purgeExpired())
  }

  @Test
  fun theShareIntentGrantsTemporaryReadAccessOnly() {
    val spec =
        ShareIntent.describe(
            "content://com.trezor.app.attachments/shared/${"ab".repeat(16)}/Receipt.pdf",
            MediaTypes.PDF,
            "Receipt.pdf")
    assertEquals("android.intent.action.SEND", spec.action)
    assertEquals(MediaTypes.PDF, spec.mimeType)
    assertEquals("Receipt.pdf", spec.fileName)
    assertEquals(ShareIntent.FLAG_GRANT_READ_URI_PERMISSION, spec.flags)
    // No write (0x2) or persistable (0x40) grant.
    assertEquals(0, spec.flags and (0x2 or 0x40))

    for ((uri, type) in
        listOf(
            "file:///data/user/0/com.trezor.app/cache/x.pdf" to MediaTypes.PDF,
            "content://com.trezor.app.attachments/shared/x/a.txt" to "text/plain")) {
      try {
        ShareIntent.describe(uri, type, "a")
        fail("must refuse $uri $type")
      } catch (e: IllegalArgumentException) {
        // expected
      }
    }
  }

  @Test
  fun theFileProviderServesOnlyTheShareCacheAndIsNotExported() {
    // Gradle runs unit tests from the app module directory.
    val paths = parse(File("src/main/res/xml/attachment_share_paths.xml"))
    val entries = children(paths.documentElement)
    assertEquals(1, entries.size)
    assertEquals("cache-path", entries[0].tagName)
    assertEquals("attachments/share/", entries[0].getAttribute("path"))

    val manifest = parse(File("src/main/AndroidManifest.xml"))
    val providers = manifest.getElementsByTagName("provider")
    assertEquals(1, providers.length)
    val provider = providers.item(0) as Element
    val android = "http://schemas.android.com/apk/res/android"
    assertEquals("androidx.core.content.FileProvider", provider.getAttributeNS(android, "name"))
    assertEquals("\${applicationId}${ShareIntent.AUTHORITY_SUFFIX}", provider.getAttributeNS(android, "authorities"))
    assertEquals("false", provider.getAttributeNS(android, "exported"))
    assertEquals("true", provider.getAttributeNS(android, "grantUriPermissions"))
    val meta = children(provider).single()
    assertEquals("@xml/attachment_share_paths", meta.getAttributeNS(android, "resource"))

    // The module writes share files into exactly that directory.
    val module = File("src/main/java/com/trezor/app/attachments/TrezorAttachmentsModule.kt").readText()
    assertTrue(module.contains("ShareFiles(store, File(reactContext.cacheDir, \"attachments/share\"))"))
    // Startup cleanup (collectGarbage) removes expired shares too.
    val startup = module.substringAfter("override fun collectGarbage").substringBefore("\n  }\n")
    assertTrue(startup.contains("shares.purgeExpired()"))
  }

  private fun parse(file: File) =
      DocumentBuilderFactory.newInstance()
          .apply { isNamespaceAware = true }
          .newDocumentBuilder()
          .parse(file)

  private fun children(element: Element): List<Element> =
      (0 until element.childNodes.length).map { element.childNodes.item(it) }.filterIsInstance<Element>()
}
