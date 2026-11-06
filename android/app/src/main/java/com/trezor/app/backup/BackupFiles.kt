package com.trezor.app.backup

import com.trezor.app.attachments.DirectorySync
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.SecureRandom

/**
 * Backup and Check staging in the database directory [databaseDir] (spec v2.4 §2, §6.4):
 * - `backup/<random>.db`: the export during backup creation, encrypted with that backup's
 *   ephemeral SQLCipher key;
 * - `check/<checkId>/`: the database artifact of a backup being checked (same key kind).
 *
 * Both are unusable without their BMK, are deleted after each flow, and once more when the
 * module starts. [noBackupDir]`/backup/pending-destination` holds the document URI a backup
 * is being written to, so a start after process death can delete the partial file.
 */
class BackupFiles(
    private val databaseDir: File,
    private val noBackupDir: File,
    private val freeBytes: (File) -> Long,
    private val syncDirectory: (File) -> Unit = DirectorySync::sync,
) {

  private val random = SecureRandom()
  val exportDir = File(databaseDir, "backup")
  private val checkRoot = File(databaseDir, "check")
  private val pendingFile = File(noBackupDir, "backup/pending-destination")

  /** A new, empty export file name in [exportDir] (the directory exists afterwards). */
  fun newExportName(): String {
    mkdir(exportDir)
    return "${randomHex()}.db"
  }

  /** A new, empty staging directory for one check. */
  fun newCheckDir(): Pair<String, File> {
    mkdir(checkRoot)
    val id = randomHex()
    val dir = File(checkRoot, id)
    if (!dir.mkdir()) throw IOException("Could not create a check directory")
    return id to dir
  }

  /** The staging directory of [checkId]; ids are generated here, so anything else is refused. */
  fun checkDir(checkId: String): File {
    require(ID.matches(checkId)) { "Invalid check id" }
    return File(checkRoot, checkId)
  }

  fun deleteCheck(checkId: String) {
    checkDir(checkId).deleteRecursively()
  }

  fun deleteExport(name: String) {
    require(EXPORT.matches(name)) { "Invalid export name" }
    for (suffix in listOf("", "-journal")) File(exportDir, name + suffix).delete()
  }

  /**
   * Fails with [InsufficientSpace] unless [bytes] plus 16 MiB are free in the database
   * directory's file system (spec §9.6).
   */
  fun requireFree(bytes: Long) {
    val needed = bytes + MARGIN_BYTES
    val available = freeBytes(databaseDir)
    if (available < needed) throw InsufficientSpace(needed, available)
  }

  class InsufficientSpace(val needed: Long, val available: Long) : Exception("Not enough free space")

  /** Records the destination a backup is being written to (spec §6.4). */
  fun recordPendingDestination(uri: String) {
    val dir = pendingFile.parentFile!!
    mkdir(dir)
    val tmp = File(dir, "pending-destination.tmp")
    FileOutputStream(tmp).use {
      it.write(uri.toByteArray(Charsets.UTF_8))
      it.fd.sync()
    }
    if (!tmp.renameTo(pendingFile)) throw IOException("Could not record the destination")
    syncDirectory(dir)
  }

  fun clearPendingDestination() {
    pendingFile.delete()
  }

  /**
   * At module start (independent of the database): removes staged exports and checks, and
   * returns a destination left by a backup that didn't finish, then forgets it.
   */
  fun cleanupAtStart(): String? {
    exportDir.listFiles()?.forEach { it.deleteRecursively() }
    checkRoot.listFiles()?.forEach { it.deleteRecursively() }
    File(pendingFile.parentFile, "pending-destination.tmp").delete()
    val pending = if (pendingFile.isFile) pendingFile.readText(Charsets.UTF_8).ifBlank { null } else null
    pendingFile.delete()
    return pending
  }

  private fun mkdir(dir: File) {
    if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Could not create ${dir.name}")
  }

  private fun randomHex(): String = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }

  companion object {
    const val MARGIN_BYTES = 16L * 1024 * 1024
    private val ID = Regex("^[0-9a-f]{32}$")
    private val EXPORT = Regex("^[0-9a-f]{32}\\.db$")
  }
}
