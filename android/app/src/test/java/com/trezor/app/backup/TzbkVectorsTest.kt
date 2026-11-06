package com.trezor.app.backup

import com.trezor.app.attachments.AttachmentFormat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.CRC32
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Byte-exact interoperability with the independent reference (spec v2.4 §13, tests 1–11).
 * Every expected value was produced by Node crypto (OpenSSL); the Argon2id values also by
 * libsodium. The Kotlin side uses javax.crypto, java.util.zip and BouncyCastle.
 */
class TzbkVectorsTest {

  @Test
  fun crc32IsCrc32IsoHdlc() {
    for (v in Vectors.list("crc")) {
      val crc = CRC32().apply { update(unhex(v.str("input"))) }.value
      assertEquals(v.long("crc"), crc)
    }
    // The published CRC-32/ISO-HDLC check value.
    assertEquals(0xCBF43926L, Vectors.list("crc")[0].long("crc"))
  }

  @Test
  fun argon2idMatchesOpenSslAndLibsodium() {
    for (v in Vectors.list("argon2id")) {
      val header =
          TzbkHeader.unsealed(
              salt = v.hex("salt"), backupId = ByteArray(16), noncePrefix = ByteArray(7), wrapIv = ByteArray(12),
              iterations = v.int("t"))
      assertEquals(v.str("passwordText").toByteArray(Charsets.UTF_8).hex(), v.str("password"))
      assertEquals(v.str("kek"), TzbkCrypto.kek(v.hex("password"), header).hex())
    }
  }

  @Test
  fun hkdfMatchesRfc5869AndTheFourKeyKinds() {
    val rfc = Vectors.obj("rfc5869")
    assertEquals(
        rfc.str("okm"),
        TzbkCrypto.hkdf(rfc.hex("ikm"), rfc.hex("salt"), rfc.hex("info"), rfc.int("length")).hex())

    val k = Vectors.obj("keys")
    TzbkKeys(k.hex("bmk"), k.hex("backupId")).use { keys ->
      for (s in k.list("section")) {
        assertEquals(s.str("info"), TzbkKeys.sectionInfo(s.int("type"), s.long("ordinal")).hex())
        assertEquals(s.str("key"), keys.section(s.int("type"), s.long("ordinal")).hex())
      }
      assertEquals(k.str("attachmentWrap"), keys.attachmentWrap().hex())
      assertEquals(k.str("mac"), keys.mac().hex())
      assertEquals(k.str("sqlcipher"), keys.sqlcipher().hex())
    }
  }

  @Test
  fun nonceAndAadByteLayouts() {
    for (v in Vectors.list("nonceAad")) {
      val prefix = v.hex("prefix")
      val final = v["final"] as Boolean
      assertEquals(v.str("nonce"), TzbkSections.nonce(prefix, v.long("index"), final).hex())
      assertEquals(
          v.str("aad"),
          TzbkSections.aad(
                  v.hex("backupId"), v.int("type"), v.long("ordinal"), prefix, v.long("plaintextLength"),
                  v.long("index"), final)
              .hex())
    }
  }

  @Test
  fun sectionsAtEveryChunkBoundary() {
    for (v in Vectors.list("sections")) {
      val size = v.int("plaintextLength")
      val plaintext = pattern(size, v.int("plaintextSeed"))
      val at = TzbkSections.Context(v.hex("backupId"), v.hex("prefix"), v.int("type"), v.long("ordinal"))
      val out = ByteArrayOutputStream()
      val length = TzbkSections.encrypt(ByteArrayInputStream(plaintext), size.toLong(), out, v.hex("key"), at)
      assertEquals(v.long("ciphertextLength"), length)
      assertEquals("size $size", v.str("sha256"), sha256(out.toByteArray()))
      (v["hex"] as String?)?.let { assertEquals(it, out.toByteArray().hex()) }

      val back = ByteArrayOutputStream()
      TzbkSections.decrypt(ByteArrayInputStream(out.toByteArray()), length, back, v.hex("key"), at)
      assertArrayEquals(plaintext, back.toByteArray())
    }
  }

  @Test
  fun headerWithWrappedBmk() {
    val v = Vectors.obj("header")
    val unsealed = TzbkHeader.unsealed(v.hex("salt"), v.hex("backupId"), v.hex("noncePrefix"), v.hex("wrapIv"), v.int("t"))
    val kek = TzbkCrypto.kek(v.str("password").toByteArray(Charsets.UTF_8), unsealed)
    assertEquals(v.str("kek"), kek.hex())
    val header = TzbkHeader.sealed(unsealed, TzbkCrypto.wrapBmk(kek, v.hex("bmk"), unsealed))
    assertEquals(v.str("header"), header.encoded().hex())

    val parsed = TzbkHeader.parse(v.hex("header"))
    assertEquals(v.str("bmk"), TzbkCrypto.unwrapBmk(kek, parsed).hex())
    assertEquals(v.str("noncePrefix"), parsed.noncePrefix.hex())
  }

  @Test
  fun tzaFilesAndRewrapMatchTheReference() {
    for (v in Vectors.list("tza")) {
      val size = v.int("plaintextLength")
      val plaintext = pattern(size, v.int("plaintextSeed"))
      val out = ByteArrayOutputStream()
      // AttachmentFormat draws the DEK, the wrap IV, then the nonce prefix.
      AttachmentFormat.encrypt(
          ByteArrayInputStream(plaintext), out, v.str("id"), v.hex("key"), Long.MAX_VALUE,
          FixedRandom(v.hex("dek"), v.hex("wrapIv"), v.hex("prefix")))
      val file = out.toByteArray()
      assertEquals(v.long("fileLength"), file.size.toLong())
      assertEquals(v.long("tzaSize"), TzaSection.size(size.toLong()))
      assertEquals(v.str("header"), file.copyOf(76).hex())
      assertEquals("size $size", v.str("sha256"), sha256(file))
      TzaSection.checkHeader(file)

      val r = v.obj("rewrap")
      val moved = ByteArrayOutputStream()
      AttachmentFormat.rewrap(
          ByteArrayInputStream(file), moved, v.str("id"), v.hex("key"), r.hex("newKey"), file.size.toLong(),
          FixedRandom(r.hex("newWrapIv")))
      assertEquals(r.str("sha256"), sha256(moved.toByteArray()))
    }
  }

  @Test
  fun manifestCanonicalWriterMatchesJsonStringify() {
    for (v in Vectors.list("manifests")) {
      val manifest = BackupManifest.decode(v.hex("canonical"))
      assertEquals(v.str("canonical"), manifest.encode().hex())
    }
  }

  @Test
  fun aCompleteFileWrittenHereIsByteIdenticalToTheReference() {
    val f = Vectors.obj("file")
    assertEquals(f.str("sha256"), sha256(CompleteFile.write(f)))
  }

  @Test
  fun aCompleteFileWrittenByTheReferenceReadsHere() {
    val f = Vectors.obj("file")
    val bytes = Base64.getDecoder().decode(f.str("base64"))
    assertEquals(f.long("length"), bytes.size.toLong())
    assertEquals(f.str("sha256"), sha256(bytes))
    CompleteFile.readAndCheck(f, bytes)
  }
}

/** The vectors' complete file, written and read with the Kotlin library. */
internal object CompleteFile {

  fun write(f: Map<String, Any>): ByteArray {
    val h = f.obj("header")
    val unsealed = TzbkHeader.unsealed(h.hex("salt"), h.hex("backupId"), h.hex("noncePrefix"), h.hex("wrapIv"), h.int("t"))
    val bmk = f.hex("bmk")
    val kek = TzbkCrypto.kek(f.str("password").toByteArray(Charsets.UTF_8), unsealed)
    val header = TzbkHeader.sealed(unsealed, TzbkCrypto.wrapBmk(kek, bmk, unsealed))
    val manifest = BackupManifest.decode(manifestBytes(f))
    val out = ByteArrayOutputStream()
    TzbkKeys(bmk, header.backupId).use { keys ->
      val writer = TzbkWriter(out, header, keys, manifest.attachments.size)
      writer.writeManifest(manifest.encode())
      val db = f.obj("database")
      val dbBytes = pattern(db.int("length"), db.int("seed"))
      writer.writeDatabase(ByteArrayInputStream(dbBytes), dbBytes.size.toLong())
      f.list("attachments").forEachIndexed { i, a ->
        val section = attachmentSection(f, a, keys)
        writer.writeAttachment(i, ByteArrayInputStream(section), section.size.toLong())
      }
      writer.finish()
    }
    return out.toByteArray()
  }

  /** The device file, rewrapped from the device key to the backup's attachment wrap key. */
  fun attachmentSection(f: Map<String, Any>, a: Map<String, Any>, keys: TzbkKeys): ByteArray {
    val device = ByteArrayOutputStream()
    AttachmentFormat.encrypt(
        ByteArrayInputStream(pattern(a.int("size"), a.int("seed"))), device, a.str("id"), f.hex("deviceAttachmentKey"),
        Long.MAX_VALUE, FixedRandom(a.hex("dek"), a.hex("wrapIv"), a.hex("prefix")))
    val file = device.toByteArray()
    val section = ByteArrayOutputStream()
    val wrap = keys.attachmentWrap()
    AttachmentFormat.rewrap(
        ByteArrayInputStream(file), section, a.str("id"), f.hex("deviceAttachmentKey"), wrap, file.size.toLong(),
        FixedRandom(a.hex("sectionWrapIv")))
    wrap.fill(0)
    return section.toByteArray()
  }

  fun manifestBytes(f: Map<String, Any>): ByteArray {
    // The vector's manifest object, re-encoded by the reference's rules (JSON.stringify).
    val m = f.obj("manifest")
    val app = m.obj("app")
    val db = m.obj("database")
    return BackupManifest(
            createdAt = m.long("createdAt"),
            app = BackupManifest.App(app.str("platform"), app.str("versionName"), app.long("versionCode")),
            database = BackupManifest.Database(db.long("sizeBytes"), db.str("sha256")),
            attachments =
                m.list("attachments").map {
                  BackupManifest.Attachment(
                      it.int("ordinal"), it.str("id"), it.str("fileName"), it.str("mimeType"), it.long("sizeBytes"),
                      it.str("sha256"), it.int("formatVersion"), it.long("tzaSizeBytes"))
                },
        )
        .encode()
  }

  fun readAndCheck(f: Map<String, Any>, bytes: ByteArray) {
    TzbkReader.open(ByteArrayInputStream(bytes), f.str("password").toByteArray(Charsets.UTF_8)).use { reader ->
      val manifest = BackupManifest.decode(reader.readManifest())
      assertEquals(f.obj("manifest").long("createdAt"), manifest.createdAt)
      val db = ByteArrayOutputStream()
      reader.readDatabase(db)
      assertEquals(manifest.database.sha256, sha256(db.toByteArray()))
      val wrap = readerKeys(reader)
      manifest.attachments.forEachIndexed { i, a ->
        val section = ByteArrayOutputStream()
        reader.readAttachment(i, a.tzaSizeBytes, section)
        TzaSection.checkHeader(section.toByteArray())
        val plain = ByteArrayOutputStream()
        val result = AttachmentFormat.decrypt(ByteArrayInputStream(section.toByteArray()), plain, a.id, wrap)
        assertEquals(a.sha256, result.sha256)
        assertEquals(a.sizeBytes, result.sizeBytes)
      }
      reader.finish(manifest.attachments.size)
    }
  }

  /** The attachment wrap key, derived independently of the reader from the vector's BMK. */
  private fun readerKeys(reader: TzbkReader): ByteArray =
      TzbkKeys(Vectors.obj("file").hex("bmk"), reader.header.backupId).use { it.attachmentWrap() }
}
