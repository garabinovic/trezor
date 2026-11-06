package com.trezor.app.backup

import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.attachments.MediaTypes

/**
 * The backup manifest, manifest version 1 (spec §3.8). [decode] parses strictly and checks
 * every field rule; [encode] writes the canonical form (fixed key order, no whitespace,
 * JSON.stringify escaping) after the same checks. Comparing the manifest with the staged
 * database's rows is Step 2.
 */
data class BackupManifest(
    val createdAt: Long,
    val app: App,
    val database: Database,
    val attachments: List<Attachment>,
    val schemaVersion: Int = SCHEMA_VERSION,
) {
  data class App(val platform: String, val versionName: String, val versionCode: Long)

  data class Database(val sizeBytes: Long, val sha256: String)

  data class Attachment(
      val ordinal: Int,
      val id: String,
      val fileName: String,
      val mimeType: String,
      val sizeBytes: Long,
      val sha256: String,
      val formatVersion: Int,
      val tzaSizeBytes: Long,
  )

  companion object {
    const val FORMAT = "trezor-backup-manifest"
    const val MANIFEST_VERSION = 1
    const val SCHEMA_VERSION = 3
    const val ATTACHMENT_FORMAT_VERSION = 1
    private const val MAX_DEPTH = 3
    private val SHA256 = Regex("^[0-9a-f]{64}$")
    private val MIME_TYPES =
        setOf(MediaTypes.JPEG, MediaTypes.PNG, MediaTypes.WEBP, MediaTypes.HEIC, MediaTypes.HEIF, MediaTypes.PDF)
    private val TOP = listOf("format", "manifestVersion", "createdAt", "app", "schemaVersion", "database", "attachments")
    private val APP = listOf("platform", "versionName", "versionCode")
    private val DATABASE = listOf("sizeBytes", "sha256")
    private val ATTACHMENT =
        listOf("ordinal", "id", "fileName", "mimeType", "sizeBytes", "sha256", "formatVersion", "tzaSizeBytes")

    /** Parses and validates a manifest; any violation is BACKUP_CORRUPT or BACKUP_INCONSISTENT. */
    fun decode(utf8: ByteArray): BackupManifest {
      if (utf8.size > Tzbk.MAX_MANIFEST_BYTES) tooLarge("Manifest too large")
      val root = obj(StrictJson.parse(utf8, MAX_DEPTH), TOP)
      if (str(root, "format") != FORMAT) unsupported("Manifest format")
      if (int(root, "manifestVersion") != MANIFEST_VERSION.toLong()) unsupported("Manifest version")
      if (int(root, "schemaVersion") != SCHEMA_VERSION.toLong()) unsupported("Schema version")
      val app = obj(root["app"], APP)
      val db = obj(root["database"], DATABASE)
      val list = root["attachments"] as? List<*> ?: corrupt("attachments is not an array")
      val manifest =
          BackupManifest(
              createdAt = int(root, "createdAt"),
              app = App(str(app, "platform"), str(app, "versionName"), int(app, "versionCode")),
              database = Database(int(db, "sizeBytes"), str(db, "sha256")),
              attachments =
                  list.map { entry ->
                    val a = obj(entry, ATTACHMENT)
                    Attachment(
                        ordinal = int(a, "ordinal").let { if (it > Int.MAX_VALUE) inconsistent("ordinal") else it.toInt() },
                        id = str(a, "id"),
                        fileName = str(a, "fileName"),
                        mimeType = str(a, "mimeType"),
                        sizeBytes = int(a, "sizeBytes"),
                        sha256 = str(a, "sha256"),
                        formatVersion =
                            int(a, "formatVersion").let { if (it > Int.MAX_VALUE) unsupported("formatVersion") else it.toInt() },
                        tzaSizeBytes = int(a, "tzaSizeBytes"),
                    )
                  },
          )
      manifest.validate()
      return manifest
    }

    private fun obj(value: Any?, keys: List<String>): Map<*, *> {
      val map = value as? Map<*, *> ?: corrupt("Expected an object")
      // Exactly these keys: none missing, none unknown.
      if (map.keys != keys.toSet()) corrupt("Manifest fields")
      return map
    }

    private fun str(map: Map<*, *>, key: String): String = map[key] as? String ?: corrupt("$key is not a string")

    private fun int(map: Map<*, *>, key: String): Long = map[key] as? Long ?: corrupt("$key is not an integer")

    private fun codePoints(s: String) = s.codePointCount(0, s.length)
  }

  /** The field rules of spec §3.8. */
  fun validate() {
    if (schemaVersion != SCHEMA_VERSION) unsupported("Schema version")
    if (createdAt !in 0..StrictJson.MAX_SAFE_INTEGER) corrupt("createdAt")
    if (app.platform != "android" && app.platform != "ios") corrupt("app.platform")
    if (codePoints(app.versionName) !in 1..64) corrupt("app.versionName")
    if (app.versionCode !in 0..Int.MAX_VALUE.toLong()) corrupt("app.versionCode")
    if (database.sizeBytes !in 1..Tzbk.MAX_DATABASE_BYTES) corrupt("database.sizeBytes")
    if (!SHA256.matches(database.sha256)) corrupt("database.sha256")
    if (attachments.size > Tzbk.MAX_ATTACHMENTS) tooLarge("Too many attachments")
    var total = 0L
    var previous: String? = null
    attachments.forEachIndexed { i, a ->
      if (a.ordinal != i) inconsistent("Attachment ordinal")
      if (!AttachmentStore.ID_PATTERN.matches(a.id)) inconsistent("Attachment id")
      // Sorted by id, ascending; strictly, so ids are unique too.
      if (previous != null && a.id <= previous!!) inconsistent("Attachment ids not sorted or not unique")
      previous = a.id
      if (codePoints(a.fileName) < 1) corrupt("Attachment fileName")
      if (a.mimeType !in MIME_TYPES) corrupt("Attachment mimeType")
      if (a.sizeBytes !in 0..Tzbk.MAX_ATTACHMENT_BYTES) corrupt("Attachment sizeBytes")
      if (!SHA256.matches(a.sha256)) corrupt("Attachment sha256")
      if (a.formatVersion != ATTACHMENT_FORMAT_VERSION) unsupported("Attachment formatVersion")
      if (a.tzaSizeBytes != TzaSection.size(a.sizeBytes)) inconsistent("Attachment tzaSizeBytes")
      total += a.sizeBytes
    }
    // Inclusive: exactly 4 GiB is accepted.
    if (total > Tzbk.MAX_ATTACHMENT_TOTAL_BYTES) tooLarge("Attachments exceed 4 GiB")
  }

  /** The canonical UTF-8 encoding (spec §3.8 writer). Validates first. */
  fun encode(): ByteArray {
    validate()
    val sb = StringBuilder()
    sb.append("{\"format\":").string(FORMAT)
    sb.append(",\"manifestVersion\":").append(MANIFEST_VERSION)
    sb.append(",\"createdAt\":").append(createdAt)
    sb.append(",\"app\":{\"platform\":").string(app.platform)
    sb.append(",\"versionName\":").string(app.versionName)
    sb.append(",\"versionCode\":").append(app.versionCode).append('}')
    sb.append(",\"schemaVersion\":").append(schemaVersion)
    sb.append(",\"database\":{\"sizeBytes\":").append(database.sizeBytes)
    sb.append(",\"sha256\":").string(database.sha256).append('}')
    sb.append(",\"attachments\":[")
    attachments.forEachIndexed { i, a ->
      if (i > 0) sb.append(',')
      sb.append("{\"ordinal\":").append(a.ordinal)
      sb.append(",\"id\":").string(a.id)
      sb.append(",\"fileName\":").string(a.fileName)
      sb.append(",\"mimeType\":").string(a.mimeType)
      sb.append(",\"sizeBytes\":").append(a.sizeBytes)
      sb.append(",\"sha256\":").string(a.sha256)
      sb.append(",\"formatVersion\":").append(a.formatVersion)
      sb.append(",\"tzaSizeBytes\":").append(a.tzaSizeBytes).append('}')
    }
    sb.append("]}")
    return sb.toString().toByteArray(Charsets.UTF_8)
  }

  /** ECMAScript JSON.stringify escaping; only U+0000–U+001F, `"` and `\` are escaped. */
  private fun StringBuilder.string(s: String): StringBuilder {
    var i = 0
    while (i < s.length) {
      val c = s[i]
      if (Character.isSurrogate(c)) {
        require(Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1])) {
          "Unpaired surrogate"
        }
        i += 2
      } else {
        i++
      }
    }
    append('"')
    for (c in s) {
      when (c) {
        '"' -> append("\\\"")
        '\\' -> append("\\\\")
        '\b' -> append("\\b")
        '\u000C' -> append("\\f")
        '\n' -> append("\\n")
        '\r' -> append("\\r")
        '\t' -> append("\\t")
        else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
      }
    }
    return append('"')
  }
}

/** TZA v1 rules for backup attachment sections (Annex A §A.5–A.7). */
object TzaSection {
  const val HEADER_BYTES = 76

  /** `76 + q + 16 × max(1, ⌈q / 65536⌉)` (Annex A §A.6). */
  fun size(plaintextBytes: Long): Long {
    require(plaintextBytes >= 0)
    return HEADER_BYTES + TzbkSections.ciphertextLength(plaintextBytes)
  }

  /**
   * Checks the first 76 bytes of an attachment section: magic `TZA1`, version 1 and, in a
   * backup, chunk size exactly 65536 (Annex A §A.6).
   */
  fun checkHeader(header: ByteArray) {
    if (header.size < HEADER_BYTES) corrupt("Attachment header truncated")
    if (header[0] != 'T'.code.toByte() || header[1] != 'Z'.code.toByte() ||
        header[2] != 'A'.code.toByte() || header[3] != '1'.code.toByte()) {
      corrupt("Not a TZA file")
    }
    if (header[4].toInt() and 0xff != 1) unsupported("TZA version")
    if (BigEndian.u32(header, 5) != Tzbk.CHUNK_SIZE.toLong()) unsupported("TZA chunk size")
  }
}
