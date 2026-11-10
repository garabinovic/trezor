# Annex B — SQLCipher configuration and schema v3 (normative)

Part of Phase 6 specification v2.4. Sources are at commit `7277967`; `sqlite3.c` means `node_modules/@op-engineering/op-sqlite/cpp/sqlcipher/sqlite3.c` of op-sqlite 19.0.3.

## B.1 Engine

| Item | Value | Source |
|---|---|---|
| Library | op-sqlite 19.0.3, SQLCipher enabled | `package.json:13, 49-51` |
| SQLCipher | 4.19.0 community | `sqlite3.c:110884, 110888` |
| SQLite core | 3.53.4 | `sqlite3.c:499` |
| Crypto provider (Android) | OpenSSL 3.3.2 (`io.github.ronickg:openssl:3.3.2-1`) | `op-sqlite/android/build.gradle:350`, `android/CMakeLists.txt:54-65` |

The app sets **no** cipher pragma anywhere; every connection uses the SQLCipher 4 defaults (`grep cipher_ src/` finds only `cipher_version` and `cipher_integrity_check`).

## B.2 Pinned parameters (all TZBK database artifacts and restored databases)

| Parameter | Value | Source |
|---|---|---|
| Page size | 4096 | `sqlite3.c:111083` |
| Page cipher | AES-256-CBC | `sqlite3.c:115506, 116016` |
| Per-page IV | 16 bytes | `sqlite3.c:110933` (`CIPHER_MAX_IV_SZ`) |
| HMAC | HMAC-SHA512 over each page, page number little-endian | `sqlite3.c:111085`, `DEFAULT_CIPHER_FLAGS = HMAC \| LE_PGNO` (`:110912`) |
| Reserve per page | 80 bytes (IV 16 + HMAC 64, rounded to the 16-byte block) | `sqlite3.c:111999-112016` |
| KDF | PBKDF2-HMAC-SHA512, 256 000 iterations; **not used** for the encryption key with a raw key | `sqlite3.c:111082, 111086` |
| HMAC key | PBKDF2-HMAC-SHA512 of the key with the salt XOR `0x3a`, 2 iterations | `sqlite3.c:110920, 110929` |
| Salt | 16 random bytes at file offset 0 (page 1) | `FILE_HEADER_SZ 16`, `sqlite3.c:110878` |
| Plaintext header | 0 bytes | `sqlite3.c:111084` |
| Key form | raw key `x'<64 hex>'`: the 32 bytes are the encryption key, the salt is read from the file | `sqlite3.c:112620-112690` (option 1, "raw key only"); the app's `rawKey`, `src/storage/sqlcipher.ts:23-26` |

**Requirements:**

1. Writers MUST NOT set any `cipher_*` pragma. Artifacts are created with `ATTACH DATABASE ? AS <alias> KEY ?` (raw key) and `sqlcipher_export` (`src/storage/snapshot.ts:96-125`).
2. Every connection Phase 6 opens on an artifact, staging database or restored database MUST, right after opening, read the values below and fail closed (`BACKUP_UNSUPPORTED`) if any differs.

   **What this proves (L2):** these pragmas report the *connection's* settings, not values stored in the file (`sqlite3.c:113787-114001`). The check detects a SQLCipher build or library with different defaults. Whether a file was written with other parameters shows up differently: such a file fails to open with these settings (wrong HMAC or page layout → SQLite code 26). Both cases fail closed.

   | Pragma | Expected value |
   |---|---|
   | `PRAGMA cipher_version` | starts with `4.` |
   | `PRAGMA cipher_page_size` | `4096` |
   | `PRAGMA cipher_hmac_algorithm` | `HMAC_SHA512` |
   | `PRAGMA cipher_kdf_algorithm` | `PBKDF2_HMAC_SHA512` |
   | `PRAGMA cipher_use_hmac` | `1` |
   | `PRAGMA cipher_plaintext_header_size` | `0` |

3. Staging connections set `PRAGMA journal_mode = DELETE`. `PRAGMA temp_store = MEMORY` is redundant: op-sqlite builds SQLite with `-DSQLITE_TEMP_STORE=3` (`op-sqlite/android/CMakeLists.txt:59`), so **every** connection, the live one included, keeps temporary tables and sort data in memory. This includes `integrity_check` on a database of up to 256 MiB. The memory cost is documented; `largeHeap` is never set. Implementations may still set the pragma explicitly for clarity.
4. A future iOS reader MUST use SQLCipher 4.x with these exact parameters. The format depends on them, not on op-sqlite.

## B.3 The database artifact

- **What it is:** a SQLCipher database file with the parameters of §B.2, keyed with the TZBK SQLCipher artifact key (spec §3.5) as `x'<64 lowercase hex>'`, produced by `sqlcipher_export` from the live database, with `PRAGMA <alias>.user_version = 3` set explicitly afterwards, because `sqlcipher_export` doesn't copy it (`src/storage/snapshot.ts:110-111`).
- **Its bytes:** they contain SQLCipher's random salt and random per-page IVs, so two exports of the same data are never identical. The manifest's `database.sizeBytes` and `database.sha256` describe the bytes of *this* file.
- **Test vectors:** complete-backup vectors are therefore **verification** vectors: a fixed `.trezorbackup` file and its password, which every implementation MUST open and verify with the documented results. Byte-exact vectors exist for the parts without SQLCipher: header, keys, nonces, AAD, framing, TZA. **Section and trailer vectors that include a database section take the artifact bytes as a fixed input** (a published artifact file plus its SHA-256), so they are byte-exact given that input (L5). No vector requires an implementation to *produce* an artifact byte for byte.

## B.4 Verification of an artifact, staged or restored database

With key K, on a separate connection opened `failOnCreate` (`src/storage/sqlcipher.ts:44-62`):

1. `SELECT count(*) FROM sqlite_master` succeeds; a wrong key gives SQLite code 26 (`src/storage/sqlcipher.ts:74-85`).
2. The pragma checks of §B.2.
3. `PRAGMA cipher_integrity_check` returns no rows.
4. `PRAGMA integrity_check` returns exactly `ok`. This is the full check, not `quick_check`.
5. `PRAGMA foreign_key_check` returns no rows.
6. `PRAGMA user_version` = 3.
7. Schema check (§B.6).
8. For artifacts and the restored database: the `attachments` rows compared with the manifest (spec §7 step 6), or with the `.tza` files (spec §8.5, `verifying`).

## B.5 Export to the device key (restore)

On a connection to `D/restore/incoming.db` (artifact key):

1. `ATTACH DATABASE ? AS staged KEY ?` with `D/restore/trezor.db` and the device database key in raw form.
2. `SELECT sqlcipher_export('staged')`.
3. `PRAGMA staged.user_version = 3`.
4. `DETACH DATABASE staged`.

Then the settings rewrite (spec §8.8) and §B.4 run on `trezor.db` with the device key, and the connection is closed. The artifact key never becomes a device key.

## B.6 Schema v3

**Normative reference:** the schema produced by the **same app build** when it runs its own migrations (`src/storage/migrations.ts:22-155`, via `runMigrations`, `:206-266`) on a new, empty database. It is created at verification time in the staging directory with a random key, compared, and deleted.

**Comparison:** the multiset of `(type, name, tbl_name, sql)` rows from `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'` MUST be equal, byte for byte, for the database under test and the reference. Anything else is `BACKUP_INCONSISTENT`.

Comparing against the running app's own reference keeps the check exact for the SQLite version that is running. `sqlcipher_export` copies the stored `sql` text unchanged (`sqlite3.c:114843` ff.), so an artifact compares equal to its source database.

**Limit (L1):** the stored DDL of `reminders` and `cards` was rewritten by the SQLite that ran `ALTER TABLE … RENAME` / `ADD COLUMN` (`migrations.ts:119, 150-152`) on the device where the database was migrated. The reference is built by the SQLite of the current build. The check is therefore exact only while both are the same version. Only op-sqlite 19.0.3 (SQLite 3.53.4) has ever shipped. If a later build ships another SQLite whose rewritten DDL differs, the check fails closed: backup creation of older databases and restore of older backups stop with `BACKUP_INCONSISTENT`.

Requirement: before any op-sqlite or SQLite upgrade, a cross-version vector MUST show that a database migrated with the old version and a reference built with the new version compare equal. If they don't, the upgrade MUST ship a reviewed normalization rule for the affected DDL text. Until then the upgrade is blocked.

**Expected content** (informative, captured by running `migrations.ts` on node:sqlite **SQLite 3.54.1**, not the app's 3.53.4; Step 2 MUST re-capture it with the SQLCipher 4.19.0 harness and record any difference):

| type | name | tbl_name |
|---|---|---|
| index | `attachments_item_place` | attachments |
| index | `items_type_updated` | items |
| index | `reminders_open_due` | reminders |
| table | `attachments` | attachments |
| table | `cards` | cards |
| table | `documents` | documents |
| table | `items` | items |
| table | `notes` | notes |
| table | `reminders` (stored as `CREATE TABLE "reminders" (…)` after the v2 rename) | reminders |
| table | `settings` | settings |

Further facts from the capture:

- `cards` ends with `, issuer TEXT NOT NULL DEFAULT '') STRICT` (the v3 `ADD COLUMN`).
- `reminders` has `interval_minutes BETWEEN 15 AND 43200` (`MIN_INTERVAL_MINUTES`/`MAX_INTERVAL_MINUTES`, `src/reminders/recurrence.ts:34-35`).
- All tables are `STRICT`.
- `user_version` = 3.

The complete captured SQL text is in `scratchpad/schema/` (`capture.js` output) and goes into the Step 2 documentation.

## B.7 Settings table

`settings(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT`. Values are JSON text (`src/storage/SettingsRepository.ts:25-50`).

Keys today (`:5-13`):

| Key | Valid values | Restore rule |
|---|---|---|
| `theme.preference` | `"system"`, `"light"`, `"dark"` | kept from the backup |
| `notifications.showDetails` | `true`, `false` | kept from the backup |
| `notifications.permissionRequested` | `true`, `false` | device-local |
| `notifications.exactAlarmRequested` | `true`, `false` | device-local |

Restore applies spec §8.8.
