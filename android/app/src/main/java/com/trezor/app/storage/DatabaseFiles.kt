package com.trezor.app.storage

import java.io.File
import java.io.IOException

/**
 * File operations on the app's private database directory that SQLite cannot do itself.
 *
 * Every answer is definite or an exception: "absent" is only returned when the directory
 * listing proves the file is not there, so an I/O or permission problem can never be
 * mistaken for a missing database (which would lead to a new key being created).
 */
class DatabaseFiles(private val dir: File) {

  enum class State {
    PRESENT,
    ABSENT,
  }

  fun state(name: String): State {
    val file = File(dir, validName(name))
    if (file.exists()) {
      if (!file.isFile) throw IOException("$name exists but is not a regular file")
      return State.PRESENT
    }
    // exists() == false can also mean "could not stat". Confirm from a listing.
    if (!dir.exists()) {
      val parent = dir.parentFile ?: throw IOException("Database directory has no parent")
      val siblings = parent.list() ?: throw IOException("Cannot list ${parent.name}")
      if (siblings.contains(dir.name)) throw IOException("Database directory is not accessible")
      return State.ABSENT
    }
    val names = dir.list() ?: throw IOException("Cannot list database directory")
    if (names.contains(name)) throw IOException("$name is listed but not accessible")
    return State.ABSENT
  }

  /** Atomic rename within the directory. Never replaces an existing target. */
  fun renameNoReplace(from: String, to: String) {
    val source = File(dir, validName(from))
    val target = File(dir, validName(to))
    if (state(to) != State.ABSENT) throw IOException("$to already exists")
    if (state(from) != State.PRESENT) throw IOException("$from does not exist")
    if (!source.renameTo(target)) throw IOException("Could not rename $from")
  }

  /**
   * Deletes a temporary file (and its SQLite side files). Refuses any name that is not a
   * temporary snapshot, so a real database or verified snapshot can never be deleted here.
   */
  fun deleteTemporary(name: String) {
    require(TEMPORARY_PATTERN.matches(validName(name))) { "Not a temporary file name" }
    for (suffix in listOf("", "-journal", "-wal", "-shm")) {
      val file = File(dir, name + suffix)
      if (file.exists() && !file.delete()) throw IOException("Could not delete ${file.name}")
    }
  }

  private fun validName(name: String): String {
    require(NAME_PATTERN.matches(name)) { "Invalid database file name" }
    return name
  }

  companion object {
    private val NAME_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.db$")
    private val TEMPORARY_PATTERN = Regex("^[A-Za-z0-9._-]+\\.partial\\.db$")
  }
}
