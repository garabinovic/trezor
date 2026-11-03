package com.trezor.app.vault

/**
 * Which vault keys JavaScript may touch through [TrezorVaultModule]. Only the database
 * key: op-sqlite takes the SQLCipher key from JS, so it has to cross the bridge
 * (docs/TECHNICAL_ARCHITECTURE.md §4.4). Every other key (`attachments`, `reminders`,
 * anything added later) is used by native code through [KeyVault] directly and must
 * never be handed to, or created from, JavaScript.
 *
 * Platform-free so the rule is covered by JVM tests.
 */
object JsKeyAccess {
  const val DATABASE = "database"

  private val ALLOWED = setOf(DATABASE)

  /** Throws [IllegalArgumentException] (`INVALID_ARGUMENT` in JS) for any other id. */
  fun check(keyId: String): String {
    require(keyId in ALLOWED) { "Key id is not available to JavaScript" }
    return keyId
  }
}
