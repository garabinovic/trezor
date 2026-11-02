package com.trezor.app.reminders

import android.content.Context
import com.trezor.app.vault.KeyVault
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native operational copy of the reminder schedule, so alarms can fire and re-arm while
 * the app isn't running (the SQLCipher database can only be opened from JavaScript).
 *
 * NOT authoritative: the app rebuilds it from the encrypted database on every
 * reconciliation. Reminder titles/descriptions are stored only when the user enabled
 * "Show reminder details". The file is AES-256-GCM encrypted with a random key that is
 * itself wrapped by the Android Keystore master key (KeyVault, key id "reminders").
 */
object ScheduleStore {

  data class Entry(
      val id: String,
      val mode: Recurrence.Mode,
      val startAt: Long,
      val localStart: String,
      val intervalMinutes: Int?,
      /** Only present when reminder details may be shown. */
      val title: String?,
      val body: String?,
      /** The occurrence the current alarm is armed for (UTC ms), if any. */
      val armedFor: Long?,
  ) {
    fun spec(): Recurrence.Spec? {
      val local = Recurrence.LocalDateTime.parse(localStart) ?: return null
      return Recurrence.Spec(mode, startAt, local, intervalMinutes)
    }
  }

  data class Record(
      val showDetails: Boolean = false,
      val entries: List<Entry> = emptyList(),
      /** ONCE reminders that fired and are waiting for the app to mark them completed. */
      val fired: Set<String> = emptySet(),
  )

  private const val VERSION = 1
  private const val KEY_ID = "reminders"
  private const val IV_BYTES = 12
  private val AAD = "trezor.reminder-schedule|$VERSION".toByteArray(Charsets.UTF_8)
  private val random = SecureRandom()

  private fun file(context: Context) = File(context.noBackupFilesDir, "reminders/schedule.bin")

  private fun vault(context: Context) = KeyVault(File(context.noBackupFilesDir, "keys"))

  private fun withKey(context: Context, block: (SecretKeySpec) -> Unit) {
    val vault = vault(context)
    val raw = if (vault.hasKey(KEY_ID)) vault.getKey(KEY_ID) else vault.createKey(KEY_ID)
    try {
      block(SecretKeySpec(raw, "AES"))
    } finally {
      raw.fill(0)
    }
  }

  /** Missing, unreadable or tampered files read as empty: the app rebuilds them. */
  @Synchronized
  fun load(context: Context): Record {
    val f = file(context)
    if (!f.isFile) return Record()
    return try {
      val bytes = f.readBytes()
      var json: String? = null
      withKey(context) { key ->
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes, 0, IV_BYTES))
        cipher.updateAAD(AAD)
        json = String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
      }
      decode(JSONObject(json!!))
    } catch (e: Exception) {
      Record()
    }
  }

  @Synchronized
  fun save(context: Context, record: Record) {
    val plain = encode(record).toString().toByteArray(Charsets.UTF_8)
    val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
    lateinit var sealed: ByteArray
    withKey(context) { key ->
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
      cipher.updateAAD(AAD)
      sealed = cipher.doFinal(plain)
    }
    plain.fill(0)
    val target = file(context)
    target.parentFile?.mkdirs()
    val tmp = File(target.parentFile, "${target.name}.tmp")
    FileOutputStream(tmp).use {
      it.write(iv)
      it.write(sealed)
      it.fd.sync()
    }
    if (!tmp.renameTo(target)) throw IllegalStateException("Could not store reminder schedule")
  }

  /** Read-modify-write under the same lock as load/save. */
  @Synchronized
  fun update(context: Context, change: (Record) -> Record): Record {
    val next = change(load(context))
    save(context, next)
    return next
  }

  private fun encode(record: Record): JSONObject {
    val entries = JSONArray()
    for (e in record.entries) {
      entries.put(
          JSONObject()
              .put("id", e.id)
              .put("mode", e.mode.jsValue)
              .put("startAt", e.startAt)
              .put("localStart", e.localStart)
              .put("intervalMinutes", e.intervalMinutes ?: JSONObject.NULL)
              .put("title", e.title ?: JSONObject.NULL)
              .put("body", e.body ?: JSONObject.NULL)
              .put("armedFor", e.armedFor ?: JSONObject.NULL),
      )
    }
    return JSONObject()
        .put("v", VERSION)
        .put("showDetails", record.showDetails)
        .put("entries", entries)
        .put("fired", JSONArray(record.fired.toList()))
  }

  private fun decode(json: JSONObject): Record {
    if (json.optInt("v") != VERSION) return Record()
    val entries = mutableListOf<Entry>()
    val array = json.optJSONArray("entries") ?: JSONArray()
    for (i in 0 until array.length()) {
      parseEntry(array.getJSONObject(i))?.let(entries::add)
    }
    val fired = json.optJSONArray("fired") ?: JSONArray()
    return Record(
        showDetails = json.optBoolean("showDetails", false),
        entries = entries,
        fired = (0 until fired.length()).map { fired.getString(it) }.toSet(),
    )
  }

  /** Also used for entries sent from JavaScript. Invalid entries are dropped. */
  fun parseEntry(o: JSONObject): Entry? {
    val mode = Recurrence.Mode.of(o.optString("mode")) ?: return null
    val id = o.optString("id").takeIf { it.isNotEmpty() } ?: return null
    val entry =
        Entry(
            id = id,
            mode = mode,
            startAt = o.optLong("startAt", -1L).takeIf { it >= 0 } ?: return null,
            localStart = o.optString("localStart"),
            intervalMinutes = if (o.isNull("intervalMinutes")) null else o.optInt("intervalMinutes"),
            title = if (o.isNull("title")) null else o.optString("title"),
            body = if (o.isNull("body")) null else o.optString("body"),
            armedFor = if (o.isNull("armedFor") || !o.has("armedFor")) null else o.optLong("armedFor"),
        )
    return if (entry.spec() != null) entry else null
  }
}
