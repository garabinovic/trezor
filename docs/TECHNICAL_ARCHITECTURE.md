# Trezor — Technical Architecture

Status: **Phase 4 implemented** (encrypted attachments for cards and
documents, §14), on top of Phase 3 (reminders and local notifications, §13),
Phase 2 (core organizer), Phase 1 and the Phase 1.1 corrections. This document
describes what is built, why, and how it differs from
the Phase 1 proposal (git history: `docs: add Phase 1 technical architecture
proposal`). Phase 1.1 fixed the findings of the Phase 1 security audit; see
§10.1.

Claims marked **[verified]** were checked by an automated test or on the
Android emulator (API 37, arm64) on 2026-10-30 (Phase 1–2) or 2026-11-02
(Phase 3). Phase 4 was verified on 2026-11-03 by JVM and Jest tests, and its
schema migration also on real SQLCipher (§5). Reminders were also checked on
one physical device (§13.8). **No Phase 4 feature has run on a device or
emulator yet** (§14.10). Everything else is design intent or a recommendation.

---

## 1. Overview

```
Screens / components            (unchanged Phase 0 UI)
   │  useItems(), useItemsOfType(), useItem(), useThemePreference()
ItemsProvider / ThemeProvider   (React state; optimistic, ordered writes)
   │
StorageProvider                 (startup: opening → ready | error)
   │  openStorage()
   ├── SqliteItemRepository     ─┐
   ├── SqliteSettingsRepository ─┤  SqlDatabase interface (src/storage/sql.ts)
   │                             │
   │  serializeDatabase()  ──────┤  one FIFO for every statement on the connection
   │  openTrezorDatabase()  ─────┘  op-sqlite 19.0.3 + SQLCipher 4.19.0
   │      │
   │      ├── vault (TS) ── TrezorVault TurboModule (Kotlin) ── Android Keystore
   │      └── databaseFiles (TS) ── TrezorDatabaseFiles TurboModule (Kotlin)
   │
   ├── attachments/platform (TS) ── TrezorAttachments TurboModule (Kotlin)
   │      encrypted files, pickers, viewer copies, save a copy, share (§14)
   │
   └── InMemoryItemRepository   (debug-only sample data, tests)
```

Rules:

- Screens never import storage code or run SQL. They use the same hooks as in
  Phase 0. The only UI additions are the startup error screen and the
  write-error dialog.
- `src/storage/database.ts` is the only production module that opens
  databases. The SQL itself lives in the repositories and migrations, written
  against the small `SqlDatabase` interface.
- The same SQL runs in Jest through Node's built-in `node:sqlite`
  (`test-utils/nodeSqlite.ts`). That covers migrations and repositories, but
  not encryption.

| Path | Responsibility |
| --- | --- |
| `android/app/src/main/java/com/trezor/app/vault/` | `KeyVault` (Keystore + envelopes), `TrezorVaultModule` (JS bridge, limited to the `database` key by `JsKeyAccess`), typed `VaultException` |
| `src/native/NativeTrezorVault.ts` | TurboModule spec (app-level codegen, `codegenConfig` in `package.json`) |
| `src/storage/vault.ts` | TS wrapper; maps native rejections to `StorageError` |
| `android/app/src/main/java/com/trezor/app/storage/` | `DatabaseFiles`: definite file state, no-replace rename, temp-only delete (database directory only) |
| `android/app/src/main/java/com/trezor/app/backup/` | Phase 6. Step 1: the TZBK v1 backup format library (header, Argon2id via BouncyCastle 1.79, HKDF, chunked AES-GCM sections, trailer HMAC, strict manifest, password rules with the Unicode 8.0 table; reference and vectors in `tools/backup-format/`). Step 2: backup creation and Check backup, native half (`BackupService`, `BackupCreator`, `BackupChecker`, `BackupGate`, `BackupFiles`, module `TrezorBackup`), §8. No UI yet |
| `android/app/src/main/java/com/trezor/app/restore/` | Phase 6 Step 3: restore preparation, native half (`RestoreService`, `RestoreJournal`/`JournalStore`, `Quarantine`, `RestoreFileOps`, `RestoreLayout`, `ProcessRestart`, module `TrezorRestore`), §8.7. Never replaces live data; no swap, no recovery (Step 4), no UI (Step 5) |
| `src/backup/` | Phase 6 Steps 2–3: the JS half of backup creation and Check backup (`createBackup`, `checkBackup`; SQLCipher export and artifact verification in `artifact.ts`) and of restore preparation (`restore.ts`: `prepareRestore`, `restoreEntryFor`; step 6 helpers in `artifact.ts`), §8. Not called by any screen yet |
| `src/native/NativeTrezorDatabaseFiles.ts`, `src/storage/databaseFiles.ts` | Spec and TS wrapper for the above |
| `src/storage/database.ts` | Startup matrix, verification, snapshot, migrations |
| `src/storage/sqlcipher.ts` | Key-format check, keyed `open()` (drops the key from op-sqlite's retained options), encryption/integrity verification |
| `src/storage/snapshot.ts` | Atomic, verified pre-migration snapshots |
| `src/storage/serialDatabase.ts` | Serializes every statement and transaction on the shared connection |
| `src/storage/migrations.ts` | Schema v1 (initial), v2 (reminder scheduling) and v3 (attachments, card issuer); `user_version` migration runner; foreign-key procedure |
| `src/storage/SqliteItemRepository.ts` | Row ↔ `Item` mapping, atomic writes |
| `src/storage/SettingsRepository.ts` | Typed settings (`SettingValues`): `theme.preference`, `notifications.showDetails`, `notifications.permissionRequested`, `notifications.exactAlarmRequested` |
| `src/storage/StorageProvider.tsx`, `openStorage.ts` | Startup state for the app shell |
| `src/storage/ids.ts` | UUIDv7 |
| `src/data/search.ts` | Searchable fields per type; Unicode-aware matching (Phase 2) |
| `src/data/organizer.ts` | Category filters, sort orders, Home overview (Phase 2; moved out of screens) |
| `test-utils/appHarness.tsx` | Drives the whole app in Jest (only visible screens are queried) |
| `src/storage/selfTest.ts` | Debug-only on-device SQLCipher checks (dev menu) |
| `src/reminders/` | Recurrence rules, reminder schedule helpers, reconciliation, `RemindersProvider` (Phase 3, §13) |
| `android/app/src/main/java/com/trezor/app/reminders/` | Recurrence (Kotlin mirror), encrypted schedule record, alarms, notifications, receivers, `TrezorReminders` TurboModule (Phase 3) |
| `test-fixtures/recurrence.txt` | Hand-computed recurrence cases shared by the Jest and JVM tests |
| `android/app/src/main/java/com/trezor/app/attachments/` | TZA format, encrypted store, import rules, key policy, viewer copies, PDF rendering, export, share files, `TrezorAttachments` TurboModule (Phase 4, §14) |
| `src/attachments/`, `src/native/NativeTrezorAttachments.ts` | TS wrapper and error codes, photo tiles, zoomable image, PDF pages (Phase 4) |
| `src/screens/editor/attachmentSession.ts`, `src/screens/AttachmentViewerScreen.tsx` | Files picked while editing; the viewer with Save a copy and Share (Phase 4) |

---

## 2. Storage technology

**op-sqlite 19.0.3** (exact pin), built with SQLCipher through
`"op-sqlite": { "sqlcipher": true }` in `package.json`.

The compatibility spike results are in
[`SQLCIPHER_SPIKE.md`](SQLCIPHER_SPIKE.md). Summary:

- **[verified]** runtime: `cipher_version` = `4.19.0 community`, provider
  OpenSSL.
- **[verified]** keys: a wrong key and a missing key both fail with `code 26`.
- **[verified]** on disk: no SQLite header and no plaintext. Host `sqlite3`
  refuses to open the file.

The real `trezor.db` was checked the same way after the UI was connected
**[verified]**:
- the user's titles, card number, setting key and schema text all had 0 hits
  in the raw file;
- the header bytes are random;
- the file mode is `-rw-------`, owned by the app UID.

**Native footprint [verified]:** each ABI adds `libcrypto.so` (OpenSSL, 3.4–5.3 MB)
plus `libop-sqlite.so` (1.1–1.8 MB). The universal release APK went from 74 MB to
94 MB. Play Store App Bundles deliver one ABI per device (≈ +6.6 MB on arm64).

---

## 3. Security model

### What Android provides vs what the app adds

| Layer | Provided by | Protects against | Does not protect against |
| --- | --- | --- | --- |
| App sandbox, file mode `0600` **[verified]** | Android | Other non-root apps | Root, OS exploits, forensic extraction |
| File-based encryption | Android 10+ | Device off / before first unlock | Anything once the device has been unlocked since boot |
| `allowBackup="false"` + `dataExtractionRules` + `fullBackupContent` (all exclude everything) | Manifest | Cloud backup and device-to-device transfer carrying the data off the device | — |
| **SQLCipher database encryption** | Trezor | Reading the database file by any means (root, forensic copy, leaked file) without the key | An attacker who can run code inside the Trezor process while it is open |
| **Keystore-wrapped key** | Trezor + Android Keystore | Recovering the database key from disk; the master key cannot be exported | Same as above; loss of the Keystore key (see §4.5) |

Android's file-based encryption alone isn't enough. Once a device has been
unlocked after boot, app files are readable by root or forensic tools. The
SQLCipher layer means the database file is useless without a key that only
this app installation can unwrap.

### Threat model

| In scope | Out of scope |
| --- | --- |
| Lost or stolen device, including rooted file extraction | Malware with root running while Trezor is unlocked (it can read process memory) |
| Other apps | A compromised OS or Keystore implementation |
| Backups or device transfer copying data elsewhere | Shoulder-surfing (future app lock and `FLAG_SECURE`) |

---

## 4. Key management

### 4.1 Hierarchy

```
Android Keystore  "trezor.master.v1"  AES-256-GCM, non-exportable,
│                                    StrongBox if available, else TEE/software
├── wraps → database key (32 random bytes, SecureRandom)
│             → SQLCipher raw key  x'<64 hex>'
└── wraps → attachments key (32 random bytes; native only: the JS vault API
              accepts only "database", JsKeyAccess)
              → wraps a random key per attachment file (§14)
```

### 4.2 Master key

- Created on first use with `KeyGenParameterSpec`:
  - `PURPOSE_ENCRYPT | PURPOSE_DECRYPT`, GCM, no padding, 256-bit;
  - `setRandomizedEncryptionRequired(true)`;
  - `setIsStrongBoxBacked(true)` on API 28+, falling back to TEE/software on
    `StrongBoxUnavailableException`.
- It is **only created when no envelopes exist yet**. A new master key would
  orphan every existing envelope, so if envelopes exist and the master key is
  gone, the vault reports `MASTER_KEY_MISSING` and never replaces it
  **[verified: instrumentation test]**.
- **One lock for the whole process** (`EnvelopeStore`, audit V1). The React
  modules and the reminder code each create a `KeyVault` on the same
  directory; a lock per instance let two of them see "no master key" at once
  and both generate one, and Android Keystore silently replaces an alias.
  Under the lock the alias is re-checked, and a master key is generated only
  when the key directory can be listed (L1: a failed listing is
  `STORAGE_ERROR`, never "empty") and holds no envelope and no envelope temp
  file **[verified: JVM, several instances on one directory, fake Keystore]**.
- **Durable envelopes** (V2, L4): each write uses its own temp file name,
  is synced, renamed (an envelope is never replaced), and the directory is
  synced, plus its parent when it was just created, before the key is
  returned; a failed sync is `STORAGE_ERROR` **[verified: JVM]**. Temp files
  left by a crash are kept and never reused: one may be the only copy of an
  envelope whose rename didn't reach the disk. Recovering such a file is not
  implemented.
- Not bound to user authentication or `setUnlockedDeviceRequired`. The reasons:
  - Phase 1 has no app lock.
  - Unlocked-device binding (API 28+) would stop future features that need
    the database while the screen is locked (reminder notifications).

  Revisit both together in the app-lock phase.

**Hardware vs software backing.** The vault reports where the master key lives
(`getMasterKeySecurityLevel()`: `strongbox` / `tee` / `software`):

| Environment | Expected | Observed |
| --- | --- | --- |
| Android emulator (this project's AVD, API 37) | Software Keystore | **`software` [verified]** |
| Most phones since ~2018 | TEE (`tee`) | not tested |
| Phones with a secure element, API 28+ (e.g. Pixel 3+, recent Samsung) | `strongbox` | not tested |
| API 24–30 | Reported via deprecated `isInsideSecureHardware` → `tee` or `software` | not tested |

On a software-backed Keystore the master key is still non-exportable through
the API, but it isn't isolated from a fully compromised OS. This is a property
of the device that the app can't change. It could be surfaced to the user in a
later phase.

### 4.3 Key envelope format v1

One JSON file per key in `noBackupFilesDir/keys/` (`database.key.json`, mode
`0600`, directory `0700` **[verified]**):

```json
{
  "format": "trezor.key-envelope",
  "version": 1,
  "keyId": "database",
  "masterKeyAlias": "trezor.master.v1",
  "algorithm": "AES-256-GCM",
  "iv": "<base64, 12 bytes, generated by Keystore>",
  "ciphertext": "<base64, 32-byte key + 16-byte tag>",
  "createdAt": 1793369900302
}
```

- **GCM associated data** = `format|version|keyId|masterKeyAlias`. An envelope
  that has been renamed, or edited to claim a different key id, fails
  authentication **[verified]**.
- **Unknown future versions** are rejected with `ENVELOPE_UNSUPPORTED`, never
  guessed at **[verified]**.
- **Writes are atomic** (temp file + `fsync` + rename).
- **Wiping (limited):** the plaintext key `ByteArray`s in Kotlin are zeroed
  after use, and so is the `CharArray` used to build the hex string. The
  resulting `java.lang.String` handed to React Native **cannot be zeroed**: it
  stays on the Java heap until garbage-collected, and the JSI/Hermes and C++
  (`std::string`) copies made on the way to SQLCipher aren't zeroed either.
  See §4.4.

### 4.4 Can the database key stay out of JavaScript?

**No, not with op-sqlite's public API.** The investigation:

- `open({ name, encryptionKey })` is the only way to key a connection. It's a
  JSI function that takes the key as a JS string and passes it to
  `sqlite3_key_v2()` in C++ (verified in op-sqlite's source). There is no Java,
  Kotlin or C++ entry point that a native module could call with a key it holds
  itself.
- A native-only path would mean either linking against op-sqlite's internal C++
  symbols (unsupported, breaks on any upgrade) or forking the library. Neither
  is justified for the remaining risk.

**Where the key lives, and for how long (as implemented in Phase 1.1):**

| Copy | Lifetime | Notes |
| --- | --- | --- |
| Keystore-wrapped envelope on disk | Until data is cleared | Only ciphertext |
| Kotlin `ByteArray` (plaintext) | Zeroed right after hex conversion | `TrezorVaultModule.toHexAndZero` |
| Kotlin `String` (hex) | Until Java GC | Immutable, can't be zeroed |
| JS string from `vault.getKey()` (`keyHex`) | Local variable in `openTrezorDatabase()`; also passed to the snapshot code during a migration. Unreachable once that function returns; memory reclaimed whenever Hermes collects it | Immutable, can't be zeroed |
| `x'…'` raw-key string in the `open()` options | **Removed from the options object as soon as `open()` returns** (`openEncrypted` in `sqlcipher.ts`) | op-sqlite closes over that options object for the connection's lifetime; before Phase 1.1 this kept the key reachable all session **[verified: Jest asserts no retained options object has `encryptionKey`]** |
| `x'…'` string as a bound `ATTACH … KEY ?` parameter | Only during snapshot creation | Never part of SQL text |
| C++ `std::string` in op-sqlite's `open` | Freed (not zeroed) when `open` returns | op-sqlite source |
| SQLCipher codec context | Lifetime of each connection | Required to read and write; `cipher_memory_security` is off by default in SQLCipher 4.5+, so freed pages aren't wiped |

**What this does and doesn't guarantee:**
- Removing the key from op-sqlite's options shortens how long the key is
  *reachable* from JavaScript.
- It does **not** erase it from memory. JavaScript, Java and C++ strings can't
  be reliably wiped, and copies may persist in freed heap memory until reused.

**Other mitigations:**
- Nothing logs the key: storage logs carry error codes only, the Kotlin
  modules have no log calls, and op-sqlite's error messages contain only
  `sqlite3_errmsg` text.
- The key is never placed in SQL text.
- Key format is validated (`^[0-9a-f]{64}$`) before use, so an empty or
  malformed value can't become a weak passphrase (`INVALID_KEY_FORMAT`).
- The database key is the only key that crosses into JS.

**Residual risk:** code running inside the app process (or with root) while
Trezor is open can read the key, or the decrypted data directly. That attacker
is out of scope (§3).

### 4.5 Lifecycle scenarios

| Scenario | What happens | Data |
| --- | --- | --- |
| First launch | No envelope, no DB → master key + database key created, DB created at schema v1 **[verified]** | — |
| Normal launch | Envelope unwrapped → DB opened and verified **[verified]** | Kept |
| App update (install over) | Keystore entry, envelope and DB all kept **[verified: debug → release install]** | Kept |
| Uninstall / reinstall | Android deletes the app's Keystore entries and files | **Lost by design** (no restore yet; backup creation exists without UI, §8) |
| "Clear storage" in system settings | Files and Keystore entries removed → treated as a first launch | **Lost by design** |
| Database file state can't be determined (I/O or permission error) | `DATABASE_STATE_UNKNOWN`; no key is created **[verified: Jest]** | Kept |
| Vault returns a malformed key | `INVALID_KEY_FORMAT` before anything is opened **[verified: Jest]** | Kept |
| Envelope missing, DB present | `KEY_MISSING_FOR_DATABASE` error screen; no new key, DB untouched **[verified: envelope moved aside]**; *Try again* recovers once the envelope is back **[verified]** | Kept on disk, unreadable |
| Master key missing, envelope present | `MASTER_KEY_MISSING` **[verified: test]** | Kept on disk, unreadable |
| Envelope tampered / corrupt | `UNWRAP_FAILED` **[verified: test]** | Kept on disk, unreadable |
| Key permanently invalidated | `KEY_INVALIDATED` (not expected while the key isn't auth-bound) | Kept on disk, unreadable |
| Android backup / device transfer | Excluded by manifest rules. Even if copied, the DB is useless without the device-bound master key | Not transferred |
| New phone | Nothing migrates. An encrypted backup can be created (§8, no UI yet), but restore is not implemented | — |

The app **never** deletes, recreates or overwrites the database or a key in
response to an error. The error screen offers *Try again* only.

---

## 5. Data model and schema

### Conventions

- **IDs:** UUIDv7 (RFC 9562), from 10 bytes of `SecureRandom` via the vault
  **[verified: Jest]**. Existing string IDs still fit `TEXT PRIMARY KEY`.
- **Timestamps:** `INTEGER` ms since epoch, UTC. The repository maps them to
  the ISO strings the UI already uses. Calendar dates (purchase date, warranty
  end) stay `TEXT 'YYYY-MM-DD'`.
- **Money:** `amount_minor INTEGER` (cents) to avoid float drift. The UI keeps
  `number`.
- **Tables are `STRICT`**, with `CHECK` constraints on enum columns and
  `ON DELETE CASCADE` foreign keys. `PRAGMA foreign_keys = ON` on every
  connection.

### Schema v1 (`user_version = 1`)

```sql
items     (id TEXT PK, type TEXT CHECK(note|reminder|card|document), title TEXT,
           pinned INTEGER CHECK(0|1), created_at INTEGER, updated_at INTEGER)
           INDEX (type, updated_at DESC)
notes     (item_id PK → items ON DELETE CASCADE, body)
reminders (item_id PK → items, due_at INTEGER, repeat CHECK(...), notes, completed CHECK(0|1))
           partial INDEX (due_at) WHERE completed = 0
cards     (item_id PK → items, card_number, code_format CHECK(barcode|qr), holder_name, notes)
documents (item_id PK → items, kind CHECK(...), merchant, date TEXT, expires_on TEXT,
           amount_minor INTEGER, currency, notes)
settings  (key TEXT PK, value TEXT /* JSON */)
```

### Schema v2 (`user_version = 2`, Phase 3)

Only `reminders` changes (rebuilt, because a `CHECK` cannot be altered):

```sql
reminders (item_id PK → items ON DELETE CASCADE,
           due_at INTEGER,                 -- first occurrence, UTC ms
           local_start TEXT CHECK (GLOB 'YYYY-MM-DDTHH:MM'),  -- wall-clock start
           repeat TEXT CHECK (once|daily|weekly|monthly|yearly|interval),
           interval_minutes INTEGER NULL CHECK (15..43200),
           notes TEXT, completed INTEGER CHECK (0|1),
           CHECK ((repeat = 'interval') = (interval_minutes IS NOT NULL)))
           partial INDEX reminders_open_due (due_at) WHERE completed = 0
```

Migration 1 → 2 copies every row: `repeat` `'none'` becomes `'once'`, every
other value is kept as is; `local_start` is the stored `due_at` seen in the
device's zone at upgrade time; `interval_minutes` is `NULL`. A value outside the
known set would violate the new `CHECK` and roll the whole migration back (it
is never silently converted or dropped). It runs through the normal procedure
(§6): verified encrypted snapshot `trezor.pre-migration-v1.db` first, foreign
keys off, `foreign_key_check` before commit **[verified: Jest; emulator upgrade
from the Phase 2 release build]**.

### Schema v3 (`user_version = 3`, Phase 4)

Additive only — no table is rebuilt and no existing row is rewritten:

```sql
attachments (id TEXT PK,                      -- UUIDv7; also names the encrypted file
             item_id TEXT → items ON DELETE CASCADE,
             role TEXT CHECK (card_front|card_back|document),
             position INTEGER CHECK (>= 0),
             file_name TEXT CHECK (non-empty),  -- original display name
             mime_type TEXT,
             size_bytes INTEGER CHECK (>= 0),   -- plaintext
             sha256 TEXT CHECK (64 chars),      -- of the plaintext
             format_version INTEGER CHECK (>= 1),
             created_at INTEGER,
             CHECK (role = 'document' OR (position = 0 AND mime_type GLOB 'image/*')))
             UNIQUE INDEX attachments_item_place (item_id, role, position)
cards       + issuer TEXT NOT NULL DEFAULT ''
```

- The unique index allows one front and one back per card and a unique order
  within a document.
- Structural rules are `CHECK`s. Product limits (allowed MIME types, 25 MB per
  file, 10 per document) and "card roles only on cards" are enforced by the
  repository (`attachmentProblem`, `src/data/attachments.ts`), so they can change
  without a table rebuild.
- No file paths are stored: the native store derives the file from the id, so
  backups don't depend on this device's paths (§8).
- `SqliteItemRepository.save` replaces an item's attachment rows in the item's
  transaction and returns the ids it no longer has; `delete` returns the
  deleted item's ids. `ItemsProvider` deletes those files only after the write
  committed, and only for the user's repository, never sample data
  **[verified: Jest]**. An id that belongs to another item fails on
  the primary key and rolls the whole save back **[verified: Jest]**.
- Migration 2 → 3 keeps every existing row exactly (cards gain `issuer = ''`);
  a failure part-way rolls back to the intact v2 database **[verified: Jest]**.
  It uses the normal snapshot procedure (§6). Real `sqlcipher_export` copies
  `CREATE UNIQUE INDEX` (it has a separate pass); the test fake now does too.
- **Real SQLCipher check (2026-11-03) [verified: real SQLCipher, not on a
  device].** This used op-sqlite's own SQLCipher source, not a fake.
  - **Build:** op-sqlite 19.0.3 bundles `cpp/sqlcipher/sqlite3.c` (SQLCipher
    4.19.0, SQLite 3.53.4). It was compiled for macOS with the same SQLCipher
    flags as the Android build (`SQLITE_HAS_CODEC`, `SQLITE_TEMP_STORE=3`,
    `sqlcipher_extra_init/shutdown`, OpenSSL provider).
  - **Bridge:** a `ctypes` bridge keyed each connection with `sqlite3_key_v2`,
    as op-sqlite does.
  - **Production code:** everything above `open()` was production code:
    `openTrezorDatabase` with key checks, verification, the `sqlcipher_export`
    snapshot and `runMigrations`, plus the repositories.
  - **Data:** a v2 database was created through that path and filled with
    representative rows: 15 items, two notes with non-ASCII text, quotes and a
    newline, seven reminders covering all six repeat modes and a completed one,
    two cards (barcode and QR), four documents of all kinds with dates and
    amounts, and four settings.
  - **Results:**
    - every v2 row and schema object was unchanged, except the added `issuer`
      column (`''` on both cards);
    - reminder modes, intervals and local start times read back unchanged
      through the repository;
    - `attachments` and its unique index exist; the foreign key cascades, and
      the unique and CHECK rules reject bad rows;
    - `integrity_check` returned ok, and `foreign_key_check` and
      `cipher_integrity_check` returned no rows;
    - the snapshot is the identical v2 database, still encrypted;
    - a wrong key is refused without changing the file;
    - a failure injected after all of v3's statements left the v2 database
      byte-for-byte as before, and the real migration then succeeded on it;
    - an untouched copy of the v2 file kept the same SHA-256.
  - **Negative control:** a deliberately broken v3 (changing a note) made the
    check fail.
  - **Not covered:** the OpenSSL version (4.0.3 on the Mac vs 3.3.2 on
    Android) and Android's file system. The harness was a one-off and is not
    in the repository.

The full DDL is in `src/storage/migrations.ts`. Relationships:
`items 1—1 {notes|reminders|cards|documents}`, chosen by `type`;
`items 1—n attachments`. A save that tries to change an item's type is rejected
**[verified]**.

**Not stored (deliberately):**
- `cards.code_format` is kept but not shown until code scanning exists.
- No `rev`/version column per row. It was proposed but has no consumer yet;
  add it with sync or merge-on-restore.

### Settings

| Key | Persistent | Notes |
| --- | --- | --- |
| `theme.preference` | Yes (settings table) **[verified across restart]** | `'system' \| 'light' \| 'dark'`; read before first render |
| `notifications.showDetails` | Yes **[verified across restart]** | Boolean, default `false` (generic notification text) |
| `notifications.permissionRequested` | Yes | Boolean; the Android 13+ permission is asked at most once |
| `notifications.exactAlarmRequested` | Yes | Boolean; the "Deliver reminders on time?" explanation is shown at most once (§13.5) |
| Show sample data | **No** — debug builds only, in memory | Not visible in release **[verified]** |
| App lock, backup, restore, delete all | — | Shown as "Not available yet" (Phase 0 UI) |

---

## 6. Migrations, snapshots and foreign keys

`PRAGMA user_version` holds the schema version. `migrations` is an append-only
array of `{ version, description, up(tx) }`.

### 6.1 On every open (`openTrezorDatabase`)

1. **Existence:** `databaseFiles.state()` returns `present` or `absent`. If it
   can't tell, it rejects with `DATABASE_STATE_UNKNOWN`. It never guesses
   "absent", so an I/O or permission problem can't lead to a new key.
2. **Key:** unwrap the existing key, or create one only if there is no
   envelope *and* no database. Validate the key format.
3. **Open** with the raw key (`openEncrypted`). The key is applied by
   `sqlite3_key_v2` before any statement, then removed from the retained
   options object.
   - The main connection is **not** opened with `failOnCreate`. Attached
     databases inherit the connection's open flags, and the snapshot must be
     able to `ATTACH` a new file. This was found on the device: with
     `failOnCreate`, `ATTACH` failed with code 14.
4. **Probe** `SELECT count(*) FROM sqlite_master`: code 26 →
   `DATABASE_UNREADABLE`, code 11 → `DATABASE_CORRUPT`.
5. **Check** that `PRAGMA cipher_version` is non-empty. This proves the library
   is SQLCipher; the key itself is always applied (step 3).
6. **Check** that `PRAGMA quick_check` returns `ok`.
7. If `user_version` > latest → `NEWER_SCHEMA`. Nothing is written and no
   snapshot is taken.
8. If `0 < user_version < latest` → **verified snapshot** (§6.2). If that
   fails, the migration never starts.
9. **`runMigrations`** (§6.3).

### 6.2 Snapshot procedure (`snapshot.ts`)

Candidate names are `trezor.pre-migration-v<N>.db`, then `….2.db` … `….9.db`.

1. **Reuse check:** for each existing candidate, verify it (step 5). It is
   reused **only if** it passes *and* its schema and every row are identical to
   the current database, for example on a retry after a failed migration.
   Otherwise it is **left untouched** (never trusted, overwritten or deleted)
   and the next free name is used.
2. `PRAGMA cipher_integrity_check` on the live database.
3. Export to a new **temporary** file
   `trezor.pre-migration-v<N>.<random>.partial.db`:
   `ATTACH … KEY ?` → `sqlcipher_export()` → `PRAGMA snapshot.user_version = N`
   (the export doesn't copy it).
4. `DETACH` closes the temporary database.
5. **Verify** by reopening it as a separate connection with the key and
   `failOnCreate`:
   - it decrypts (probe query);
   - `cipher_version` is present;
   - `quick_check` is `ok`;
   - `user_version` = N;
   - schema (`sqlite_master`) and every row of every table (paged, rowid order)
     equal the live database.
6. Only then, **atomic rename** to the free final name. The native
   `renameNoReplace` refuses to replace an existing file, and returns only
   after `fsync` of the database directory, so the new name is durable
   (syncing the file doesn't persist its name; SQLite syncs a directory only
   for new journals). If that sync fails, the error is reported and the
   renamed snapshot stays under its final name, never deleted; a retry
   verifies it (step 1) and reuses it **[verified: JVM, Jest; not on a
   device]**. Deleting a temporary file isn't synced: a reappearing
   `.partial.db` is never trusted.
7. **On any failure in 3–6:** delete only this attempt's temporary file. The
   native `deleteTemporary` refuses any name not ending in `.partial.db`.
   Throw `SNAPSHOT_FAILED`; the migration never starts.

**Invalid or stale snapshots:** kept as they are (possible evidence, never
auto-deleted), never used, and a new verified snapshot is written under the
next name. If all nine names are taken by invalid snapshots, the migration
fails with `SNAPSHOT_FAILED`.

**Limitations:**
- There is no automatic restore from a snapshot. Recovery from a failed
  migration relies on the migration transaction rolling back (§6.3); snapshots
  are a manual-recovery safety net.
- Snapshots are never deleted automatically.
- Temporary files from an attempt interrupted by a crash or kill can remain.
  Their names are unique and they are never trusted.
- Directory entries aren't `fsync`ed after the rename. Java can't `fsync` a
  directory; the file contents are synced by SQLite on commit.

### 6.3 Migration procedure (`runMigrations`)

Follows SQLite's documented procedure for schema changes:

1. With nothing pending, foreign keys are simply turned ON (and verified).
2. Otherwise, **`PRAGMA foreign_keys = OFF` outside any transaction.** The
   pragma is a no-op inside one. This stops a table rebuild (create new, copy,
   `DROP`, `RENAME`) from firing `ON DELETE CASCADE`.
3. **Each migration in its own transaction**: `up(tx)`, then
   `PRAGMA foreign_key_check` **before commit**. Any violation rolls back the
   whole step (`MIGRATION_FAILED`). The `user_version` bump is part of the same
   transaction.
   - The transaction is **`BEGIN IMMEDIATE`** (F9): it holds the write lock
     before anything is read, and first re-reads `user_version`. A step
     another connection committed after `from` was read is skipped; one it
     is still running makes this attempt fail ("database is locked") without
     running anything. A deferred `BEGIN` would let both read the old version.
   - op-sqlite's `transaction()` always starts with a deferred `BEGIN
     TRANSACTION;`, so `opSqliteAdapter` issues `BEGIN IMMEDIATE`, `COMMIT`
     and `ROLLBACK` itself for this case. That bypasses op-sqlite's
     transaction queue, which is safe only because migrations run before the
     connection is shared.
4. **`PRAGMA foreign_keys = ON` in `finally`**, on success and failure. It is
   read back to confirm; if it didn't take effect (e.g. the connection were
   stuck in a transaction), the open fails.
5. The foreign-key check no longer runs after commit or on every launch, so it
   can't report a committed migration as failed (audit L2).

**Verification:**
- **Jest (real SQLite via `node:sqlite`):**
  - a *control* test shows the same rebuild with foreign keys ON wipes
    dependent rows;
  - the procedure keeps them;
  - a violation rolls back;
  - foreign keys are ON after success, failure, and with nothing pending.
- **On-device self-test (SQLCipher):** table rebuild keeps dependent rows,
  violation rolls back, foreign keys ON after open **[verified]**.

---

## 7. Runtime behaviour

- **Startup:** `StorageProvider` → `openStorage()` loads the DB, all items and
  the theme, then renders.
  - **One initialization per process (F9).** A module-level promise owns the
    one connection. A React root that mounts while it runs (a recreated
    Activity, while the JS runtime lives on) waits for it and gets the same
    connection, queue and repositories; a root that mounts later loads its own
    initial data from them. A second root never opens, migrates or cleans up.
  - If initialization fails after the database opened, the connection is
    closed once every statement already queued has settled
    (`closeWhenIdle`; op-sqlite's `close()` interrupts a running statement),
    the original error is reported, and *Try again* opens a fresh
    connection. Only the failed attempt clears the shared slot.
  - While opening, a plain view in the theme background is shown.
  - On failure, `StorageErrorScreen` shows one of five messages chosen by
    error code, the code itself, a *Try again* button, and advice not to
    uninstall.
- **Writes:** `ItemsProvider` applies a change to state immediately, then
  queues the repository write (writes run strictly in order).
  - **The editor leaves only once its item is stored** (audit V5).
    `saveItem` resolves with true when the write committed and false when it
    failed (never rejects). While it runs, Save is disabled, a second press is
    ignored and leaving is blocked. On failure the editor stays open with
    every value, *Couldn’t save your change* is shown, and the files added in
    this session belong to the editor again (Discard deletes them; a retry
    saves them) **[verified: Jest, app-level flows]**. The saving state is
    always reset in `finally`, so even an unexpected throw while saving
    leaves the editor usable (Corrective D, Low-3) **[verified: Jest]**.
  - **After a failed write** (audit V3) state is reloaded from storage only
    once every write queued behind it has settled, and the result is applied
    only if no local change was made while it read; otherwise that change's
    own step reloads. An earlier reload missed those writes, so a later save
    could write the stale copy back (a deleted document returning without its
    files). A failed reload keeps the state shown. Reminder completion (V4)
    reads and applies its result inside the queue under the same rule
    **[verified: Jest, gated repository]**.
  - **One queue per repository**, shared by every provider: a second React
    root orders its writes after those the first still has queued. If any
    root has ever written through the queue, a newly mounted root reloads
    once the queue has drained: its items were loaded by `openStorage`
    outside the queue and may predate a write, even one that settled before
    it mounted (Corrective D, Low-1) **[verified: Jest]**.
  - Below that, **every statement and transaction on the shared connection
    goes through one FIFO** (`serializeDatabase`, wrapped in `openStorage`).
  - op-sqlite only serializes `transaction()` calls with each other. A plain
    `execute()` issued during a transaction used to run *inside* it, so a theme
    change could be rolled back with an unrelated failed item save.
  - Now item saves, deletes, settings writes and reads are strictly
    sequential; errors reach their caller; a failure doesn't block later
    operations **[verified: Jest, including a control test reproducing the old
    bug]**.
  - Inside a `transaction()` callback, code must use the `tx` it receives.
    Calling the outer database from inside would wait for itself and deadlock.
    The repositories only use `tx`.
  - If a write fails, state is reloaded from storage and a dialog explains
    the change wasn't saved.
  - Covered by Jest **[verified]**.
- **Search (Phase 2):** `useItemSearch` (debounced 150 ms) calls
  `ItemRepository.search()` on the active repository: the encrypted database
  in normal use.
  - Each search reads the items from the database through the serialized
    connection.
  - Matching happens in JS (`src/data/search.ts`), because SQLite's
    `LIKE`/`lower()` only fold ASCII case and "Š" wouldn't match "š".
  - Fields searched: notes (title, body); reminders (title, description);
    cards (name, issuer, number, holder, notes); documents (title, store or
    issuer (`merchant`), notes, type label, attachment file names).
  - Results are grouped by type on screen and re-run when stored items change.
  - A failed search shows an error state, not an empty result.
- **Categories:** in the approved design the categories *are* the four item
  types (tabs, Home counts), refined by filter chips (Reminders: Upcoming/Done;
  Documents: All/Receipts/Warranties/Other). There is no user-defined category
  field. The rules live in `src/data/organizer.ts`.
- **Documents (Phase 2):**
  - every kind can store an expiry date ("Warranty until" for warranties,
    "Expires on" otherwise), validated to be after the purchase/issue date;
  - non-purchase kinds label their date "Issue date";
  - this uses the existing `expires_on` column (no schema change).
- **Sample data (debug builds):** sample data lives in a separate
  `InMemoryItemRepository`. Switching it on never writes to the database, and
  switching it off reloads stored items **[verified: Jest]**.

  In release, the switch, its handler and the self-test are removed by
  dead-code elimination **[verified: release bundle]**. The sample-data module
  itself is still bundled but unreachable.

---

## 8. Encrypted backup (Phase 6)

Specification: Phase 6 spec v2.4 (backup format §3–§4, creation §6, Check
backup §7, Annex B for the SQLCipher artifact). Implemented so far: the format
library (Step 1) and **backup creation and Check backup** (Step 2), without UI.
**Restore is not implemented**: no journal, quarantine, restore staging or
settings/reminder restore exists, and nothing in the app can replace live data
from a backup.

### 8.1 The file

A TZBK v1 file holds, in order: the 128-byte header (Argon2id parameters, salt,
backup ID, BMK wrapped under the password-derived KEK), the manifest (strict
JSON), the database section, one section per attachment and the HMAC trailer.
Every section is chunked AES-256-GCM under its own HKDF key; the file ends
exactly after the trailer.

- **Database section:** a SQLCipher 4 database (the *artifact*) made by
  `sqlcipher_export` from the live database, keyed with the backup's
  `sqlcipher` key (HKDF from the BMK), so it is a different file under a
  different key; it is not `trezor.db` and is useless without the password.
- **Attachment sections:** the attachment's TZA file with only its 76-byte
  header changed: the DEK is unwrapped with the device `attachments` key and
  wrapped again under the backup's attachment-wrap key with a new IV
  (`AttachmentFormat.rewrapHeader`). The encrypted body is copied byte for
  byte; no file is decrypted into plaintext storage.
- The manifest lists the database (size, SHA-256) and every attachment (id,
  name, type, size, SHA-256 of the plaintext, TZA size), sorted by id.

### 8.2 Who does what

| JS (`src/backup/`, op-sqlite) | Native (`backup/`, Kotlin) |
| --- | --- |
| Every SQLCipher statement: export, artifact checks | Password rules, Argon2id, keys, header |
| Reads the attachment rows from the export | Verifies, rewraps and streams attachment files |
| Decides success after the read-back check | SAF destination, `fsync`, read back, staging files, cleanup |

Native code never opens a SQLCipher database. The backup's SQLCipher key
crosses to JS (as the live database key does) so op-sqlite can create and
check the artifact; no other backup key leaves native code. Native results are
JSON; errors are codes, and only `BACKUP_ATTACHMENT_UNREADABLE`
(`attachmentId`, `itemId`, `reason`: `MISSING`, `DAMAGED`, `MISMATCH`) and
`INSUFFICIENT_SPACE` carry details. No password, key, name or URI is logged.

### 8.3 Creating a backup (`createBackup`)

1. **Begin** (native): password and confirmation rules (§4 of the spec), free
   space for the export (live database size + 16 MiB), random salt, backup ID,
   nonce prefix and BMK, Argon2id, the sealed header. One session at a time.
2. **Destination**: the system save-to picker (`CREATE_DOCUMENT`). The
   document must report size 0; one that reports another size or none is
   refused (`DESTINATION_NOT_EMPTY`, `DESTINATION_UNVERIFIED`) and never
   written or deleted. An accepted URI is recorded durably in
   `noBackupFilesDir/backup/pending-destination`.
3. **The backup gate**, held from the export until the destination is closed:
   - JS runs one *exclusive* operation on the live database queue
     (`SerialDatabase.exclusive`): every database operation queued meanwhile
     waits and runs afterwards (none is refused or lost);
   - inside it: `ATTACH … KEY`, `sqlcipher_export`, `PRAGMA
     backup.user_version = 3`, `DETACH` (no transaction open), then the
     artifact is checked on a separate connection (8.5) and its attachment
     rows are read;
   - native `BackupGate` protects the exported attachment ids: a deletion of
     one of them (`TrezorAttachments.deleteFiles`) is deferred and runs when
     the gate is released, whatever the outcome. Other deletions and imports
     are not affected (a new file is not in the exported set).
4. **Write** (native, still under the gate):
   - format limits (25 MiB per attachment, 20 000 attachments, 4 GiB in
     total) are checked first;
   - **every attachment file is verified before the destination is opened**:
     exact TZA size, header, full authenticated decryption, plaintext size and
     SHA-256 against its row. A missing, damaged (including under another
     key) or mismatching file fails the whole backup with
     `BACKUP_ATTACHMENT_UNREADABLE`; there is no partial backup without it.
     Attachments without the device `attachments` key fail with
     `KEY_UNAVAILABLE` (the key is never created). Such a failure never opens
     the destination: Android 16's Downloads provider crashes when a document
     is opened, closed and deleted in quick succession, and Android may kill
     the app with it (seen on the emulator before this order was used);
   - only then is the file written through `"wt"` (else `"w"`), flushed, `fsync`ed and
     closed; any failure there fails the backup. The size the provider then
     reports must equal the bytes written (unknown or different:
     `DESTINATION_UNVERIFIED`). Each attachment body is hashed again while it
     is copied and must match the verified file;
   - the export file is deleted.
5. **Read back** (mandatory): the destination is read completely as by Check
   backup (8.4) with the session's KEK (no second Argon2id), and JS checks the
   staged artifact against the manifest.
6. **Complete**: the pending-destination record and the session keys are
   dropped, and only now is success reported.

On any failure or cancellation after step 2, the destination is deleted where
the provider allows it; the result says `deleted`, `remains` or `none`. The
live database, attachment files and keys are not changed by a backup (the
gate only delays work).

### 8.4 Check backup (`checkBackup`)

Opens a file with the system picker (`OPEN_DOCUMENT`) and verifies all of it
**without touching the live database, attachment files, keys, reminders or
settings**:

1. header, password, Argon2id and BMK; manifest;
2. free space for the database artifact (its size + 16 MiB);
3. the database section is decrypted into
   `databases/check/<checkId>/incoming.db` (still SQLCipher-encrypted under
   the backup's key), `fsync`ed, and its size and SHA-256 compared with the
   manifest (`BACKUP_INCONSISTENT` otherwise);
4. each attachment section is decrypted in memory, streamed through the TZA
   decryptor (into nothing), and its size and SHA-256 compared;
5. the trailer HMAC and the exact end of file;
6. JS checks the staged artifact (8.5) and that its `attachments` rows and the
   manifest are the same set, field by field;
7. the staging directory is deleted, whatever the outcome.

Errors: `BACKUP_PASSWORD_OR_HEADER`, `BACKUP_UNSUPPORTED`, `BACKUP_CORRUPT`,
`BACKUP_TOO_LARGE`, `BACKUP_INSUFFICIENT_MEMORY`, `BACKUP_INCONSISTENT`,
`INSUFFICIENT_SPACE`.

### 8.5 Artifact checks (Annex B §B.4, `verifyArtifact`)

On a separate connection opened with `failOnCreate`, in this order:
`cipher_version` 4.x; `cipher_page_size` 4096, `cipher_hmac_algorithm`
HMAC_SHA512, `cipher_kdf_algorithm` PBKDF2_HMAC_SHA512, `cipher_use_hmac` 1,
`cipher_plaintext_header_size` 0 (else `BACKUP_UNSUPPORTED`);
`cipher_integrity_check` without rows and `integrity_check` = ok (else
`BACKUP_CORRUPT`); `foreign_key_check` without rows (`BACKUP_INCONSISTENT`);
`user_version` = 3 (`BACKUP_UNSUPPORTED`); and the schema in `sqlite_master`
equal to a reference built at run time in an in-memory database from the
app's own migrations (`BACKUP_INCONSISTENT`). A wrong key or damage is
`BACKUP_CORRUPT`.

### 8.6 Staging files and cleanup

| Path | What | Removed |
| --- | --- | --- |
| `databases/backup/<random>.db` | The export (SQLCipher, backup key) | After the write, on abort, and at module start |
| `databases/check/<checkId>/` | A staged artifact being checked | After each check, and at module start |
| `noBackupFilesDir/backup/pending-destination` | URI of the document being written | On completion or abort; at module start it is read, the document is deleted where possible (otherwise its name is kept for `takeIncompleteNotice`), and the record removed |

None of these is plaintext; staged artifacts are useless without the backup's
BMK. The app's own backup exclusions (§3) still exclude every file.

### 8.7 Restore preparation (Step 3)

Spec §8.1–8.4, §8.6–8.11 and §9.2–9.3, **exercised without the swap**: the
swap, the startup recovery of the state matrix (§8.5) and §8.2 steps 13–16
(closing the live connection, the pre-swap state check, the swap renames,
the restart call) are **Step 4**; the restore screens and the error-screen
entry are Step 5. Nothing in the app calls the preparation yet. In this step
every preparation ends in the pre-swap failure path, so **the live database
and attachment root are never moved, renamed or overwritten**.

**Flow** (`src/backup/restore.ts` `prepareRestore`, native steps in
`restore/RestoreService.kt` via the `TrezorRestore` module):

1. Password rules, memory pre-check, Argon2id, manifest and free space
   (§9.6: `incoming.db` + `S_db` + Σ TZA sizes + the section in transit +
   16 MiB, summed per filesystem by `st_dev`). Nothing is written.
2. The restore gate (§8.7 of the spec), in this order:
   - the **reconcile gate** (`src/reminders/reconcileGate.ts`): waits for a
     reconcile already running, holds new ones until release (taken before
     the database gate, so a reconcile waiting on a database read can't
     deadlock it);
   - one `exclusive` operation on the live database queue: later database
     work (item writes, settings, reconcile reads) waits; the coordinator's
     own statements run through the callback's executor;
   - the **native gate** (`attachments/RestoreGate.kt`): the attachments
     module refuses every new call with `RESTORE_IN_PROGRESS`; a picker
     result that arrives is refused; an import that finishes under the gate
     has its files deleted; work accepted before is drained; restore waits
     while a share is active (`ShareFiles.activeCount`), asking the caller
     to wait or cancel (`RESTORE_CANCELLED`).
3. The journal `N/restore/restore.json` (`phase = prepared`, strict JSON,
   temp file + `fsync` + rename + directory `fsync`; a `.tmp` is never read;
   anything unparseable is `RESTORE_STATE_UNKNOWN`).
4. `S_att` is created (always, also for zero attachments) and `N/restore`
   synced; the database section goes to `D/restore/incoming.db` (size and
   SHA-256 against the manifest, `fsync`). Each attachment section goes to
   `N/restore/incoming-attachment.tmp` still under the backup's wrap key, is
   verified (TZA header rules, whole body decrypted and authenticated, size
   and SHA-256), rewrapped to the device `attachments` key into
   `S_att/<id>.tza` (`AttachmentFormat.rewrap`, bounded) and that file is
   decrypted again under the device key. Then the trailer and EOF. No
   plaintext is written.
5. If a Check ran on the file in this flow: the same backup ID and trailer,
   else `BACKUP_CHANGED`.
6. (JS) `incoming.db` verified (Annex B §B.4) and its rows compared with
   the manifest; exported to `D/restore/trezor.db` (`S_db`) under the
   **device** database key (Annex B §B.5, `exportToDevice`); settings
   rewritten (§8.8: only valid `theme.preference` and
   `notifications.showDetails` kept, the two device-local values taken from
   the live database when valid, everything else dropped); `S_db` verified
   again (§B.4 and rows); `incoming.db` deleted.
7. Retained files (§9.2, `Quarantine`): `kept-ids` absent → none; valid → the
   listed ids (a missing file is counted); damaged → **every** `.tza` in the
   live root (fail closed); live root unlistable → `STORAGE_ERROR`. Each is
   hard-linked (or copied) to `N/quarantine/<restoreId>/<id>.tza`; the
   original stays; a target is never overwritten.
8. `fsync` of `S_db`, every staged attachment and the staging, restore and
   quarantine directories.
9. (JS, live connection only) fired ONCE reminders that still exist and
   aren't completed are completed, as a reconcile would.
10–11. One native call under the `ScheduleStore` monitor
   (`reminders/ScheduleRestore.kt`): the schedule copied byte for byte to
   `N/restore/schedule.saved.bin` (durably), the journal's `scheduleSaved`
   set, then the schedule cleared (`sync(entries = [])` and every shown
   `reminder:` notification) and confirmed empty. An alarm or re-arm
   arriving meanwhile waits for the whole section.
12. Decrypted caches purged on the attachments module's lanes: PDFs closed,
   every view and share deleted, both directories confirmed empty.

**Pre-swap failure path** (always taken in Step 3):
1. The schedule is restored and re-armed by `scheduleSaved`:
   - `saved` → copied back, unless an earlier attempt already did;
   - `absent` → the schedule is deleted;
   - `pending` → left as is;
   - then `rearmAll`, then the saved copy is deleted.
2. `D/restore`, `N/restore/attachments` and `N/quarantine/<restoreId>` are
   deleted.
3. The journal is deleted, and `N/restore` once it is empty.
4. The native gate is released, then the reconcile gate. Its release
   carries the ids step 9 completed: the reminders provider reloads them into
   the item state (so an edit can't write "not completed" back) and requests
   a normal reconcile.

Without a journal on disk, only what this session's own failed journal
write can leave (an empty `N/restore`, `restore.json.tmp`) is removed.
Anything else under `N/restore` or `D/restore` is reported, never deleted
and never called done. An unknown session is refused.

**When the failure path itself fails** (review M1):
- It stops at once and keeps the journal and every remaining file
  (`RESTORE_RECOVERY_RETRY`, `cleanedUp = false`).
- Only the database queue is released; the live database was never touched.
- **The native gate and the reconcile gate stay held.** Attachment work stays
  refused and **no reconcile runs**, so nothing rebuilds the schedule while
  the journal still says it is saved and cleared.
- `retryRestoreCleanup()` (JS) resumes it in the same process. The native
  session survives the failure, and every action is idempotent.
- The gates are released only once the cleanup has succeeded, and a new
  preparation is refused until then.
- If the process ends meanwhile, the journal and files stay for Step 4's
  recovery.

**Other parts:**
- **Preconditions** (`RestoreService.preflight`, §8.1 of the spec):
  - no database file → no restore entry;
  - the device database key must unwrap, else `RESTORE_UNAVAILABLE`;
  - the attachments key must unwrap if it exists. If it doesn't exist, no
    encrypted file may exist anywhere, else `RESTORE_UNAVAILABLE`;
  - a journal or restore staging without one → `RESTORE_STATE_UNKNOWN`
    (their recovery is Step 4);
  - from the error screen, `trezor.db-journal` → `RESTORE_STATE_UNKNOWN`.

  `restoreEntryFor` maps each storage error code to what the error screen
  will offer: restore, `RESTORE_UNAVAILABLE`, update, or Retry only.
- **Attachments key** (§8.6 of the spec): `AttachmentLocations.hasAnyFile`
  covers the live root, `S_att`, `P_att` and every quarantine directory,
  with the same fail-closed listing. The attachments module uses it for key
  creation.
- **Quarantine:** it is never cleaned up automatically, is never part of a
  backup, and garbage collection never sees it (GC lists only the live
  root). Only that restore's pre-swap failure deletes its directory.
- **File operations** (`RestoreFileOps`, §9.3 of the spec):
  - `syncDirectory`;
  - `renameNoReplaceDurable`: the target must be absent; both parents are
    synced;
  - `linkOrCopyDurable`: a copy goes through a temp name;
  - `deleteRecursively`: limited to `D/restore`, `D/backup`, `D/check/*`,
    `N/restore` and the current journal's `N/quarantine/<restoreId>`.
- **Restart** (`ProcessRestart`, §8.10 of the spec): it relaunches
  `MainActivity` only if it is the current activity and RESUMED, then
  finishes the task and kills the process. It is not called before Step 4.

**Process death during a preparation (accepted temporary limitation, not a
defect):** Step 3 deliberately has no startup recovery. The complete recovery
of §8.5, every row including the "no journal" guard and the `prepared` row,
is a **Step 4 requirement**, and Step 5 must not call the preparation before
it exists. Nothing calls it today. If the process ended mid-preparation, the
next normal launch would do this:
- **The live data opens normally.** It is unchanged; step 9's completions
  are the same a reconcile would make.
- **Restores are blocked.** The journal and staging stay, and every further
  restore is refused (`RESTORE_STATE_UNKNOWN`). Staged files are encrypted;
  until Step 4 they only take space, and quarantine links take none.
- **Alarms stop if the schedule had been cleared** (steps 10–11 or later):
  - no reminder alarm fires until the app is opened again, ONCE or
    recurring, and an occurrence due in that window is never notified (an
    overdue ONCE shows as overdue);
  - the next reconcile then rebuilds the schedule from the database;
  - only `fired` entries recorded **after step 9** are lost (those ONCE
    reminders show as not completed);
  - nothing is duplicated or wrongly completed.
- **After a failed cleanup** (above), restarting the app releases the in-process
  gates. Reconciliation resumes then, while the journal and files stay for
  Step 4.

### 8.8 Not verified yet

- Step 2 has run only on an isolated Android 16 emulator (API 36, Google
  APIs image), as a temporary QA release build (debug builds don't start in
  that environment, a React Native dev-path problem). There: creation with
  six attachments to the Downloads provider, its reported size, read-back,
  Check (valid, wrong password, truncated, altered header, database,
  attachment and trailer, trailing data), a damaged attachment, a non-empty
  destination, cleanup and unchanged live data. Not on a physical device,
  and no other storage provider.
- The export and artifact checks ran on real SQLCipher 4.19.0 (op-sqlite's
  amalgamation) on macOS, not on Android (§9).
- The module glue (`TrezorBackupModule`, `TrezorRestoreModule`, the
  attachments module's `deleteFiles` hook and restore-gate checks) has no
  automated test; the rules behind it are JVM-tested.
- Restore preparation (Step 3) has not run on an emulator or device: hard
  links (`Os.link`) in app storage, `Os.stat` device ids, the alarm and
  notification clearing, the cache purge on the module lanes, and the
  restart primitive are untested on Android.
- Argon2id time and memory on a physical device have not been measured.

---

## 9. Testing

| Kind | What | Result |
| --- | --- | --- |
| Jest (automated) | 136 tests in 11 suites. Phase 1/1.1 suites (66) unchanged. Phase 2 adds: repository CRUD of every field for each type, type separation, pinning, ordering, search coverage and order, deletes, database errors and invalid input, on both repository implementations (23 more in `itemRepository.test.ts`, now 40); search matching incl. non-ASCII case (7); organizer filters, sorts, Home overview, document summaries (13); editor validation and normalization (13); **app-level flows** (14) driving the real screens and navigation on the real SQLite repositories via `serializeDatabase` (Home with stored data, all tabs and filter chips, create/edit/delete/pin/complete, validation, failed write, search opens the right item, theme and data persist across a remount) | **136/136 pass** |
| Jest after Phase 3 (automated) | 228 tests in 14 suites; Phase 1–2 tests kept (fixtures updated to the v2 reminder shape; organizer sort tests updated to next-occurrence order, an intended change) plus the Phase 3 tests in §13.9 | **228/228 pass** |
| Jest after the exact-alarm change (automated) | 234 tests in 14 suites (228 + 6 exact-alarm flows, §13.9) | **234/234 pass** |
| JVM after Phase 4 step 1 | `AttachmentFormatTest` 8, `AttachmentStoreTest` 9, `RecurrenceTest` 4 | **21/21 pass** |
| Jest after Phase 4 step 2 (schema v3) | 270 tests in 14 suites: + v3 migration (additive, constraints, cascade, rollback) and attachment records for both repositories (order, card sides, removed ids, limits, ownership, rollback, search) | **270/270 pass** |
| Jest after Phase 4 step 3 (attachments module) | 284 tests in 16 suites: + pick-result parsing and error codes, startup cleanup (only unreferenced files; failure doesn't block startup; nothing when the database can't open), file deletion after committed writes only (not on failure, never for sample data), shared UUIDv7 vector | **284/284 pass** |
| JVM after Phase 4 step 3 | + `AttachmentImportRulesTest` 6 (type by content, names, UUIDv7, key policy), `AttachmentImporterTest` 5 (real store: round trip, declared type ignored, size limit with and without a declared size, unreadable sources, cleaned names) | **32/32 pass** |
| Jest after Phase 4 step 4 (cards UI) | 301 tests in 18 suites: + 12 app-level card flows (plain number without code glyphs, issuer, photos shown and their copies deleted, missing or damaged photos, create with both photos across a restart, replace, remove, failed save keeps the stored file, discard deletes new picks, failed picks explained, stored code type kept, list summary), 4 editor-session tests, view open/close codes | **301/301 pass** |
| JVM after Phase 4 step 4 | + `AttachmentViewsTest` 4 (verified copy under random names, no copy on mismatch or missing file, close refuses other paths, purge) | **36/36 pass** |
| Jest after Phase 4 step 5 (documents UI) | 323 tests in 19 suites: + 14 app-level document flows (all four types with photos and PDFs across a restart, document without attachments unchanged, detail list with type and size, reorder, replace, remove, failed save keeps files, discard, partial imports, 10-file limit and picker counts, date validation unchanged), attachment limit validation, type and size labels | **323/323 pass** |
| Jest after Phase 4 step 6 (viewer) | 336 tests in 21 suites: + 8 app-level viewer flows (card front/back paging, copies closed on switch, close and back, missing/damaged/undecodable photo, PDF page count and on-demand rendering, mixed files closed one by one, protected/unsupported/damaged/key/missing PDFs, failing page, app closed mid-view, foreground cleanup), 5 zoom-math tests | **336/336 pass** |
| JVM after Phase 4 step 6 | + `purgeInactiveKeepsOpenFilesAndRemovesClosedOrStrayOnes`; `PdfViews` uses Android's `PdfRenderer` and has no JVM test (instrumentation deferred) | **37/37 pass** |
| Jest after Phase 4 step 7 (save a copy, share) | 342 tests in 21 suites: + 6 app-level flows (image and PDF export with name and type, cancel, failure messages incl. partial file and existing destination, share of photo and PDF, missing/damaged/keyless/no receiver), foreground cleanup of expired shares; originals checked unchanged | **342/342 pass** |
| JVM after Phase 4 step 7 | + `AttachmentExportTest` 4 (exact image and PDF export, originals byte-identical, existing destination untouched, partial destination deleted or reported, damaged/missing/keyless checked first), `ShareFilesTest` 7 (checked copy in its own folder, names can't escape, nothing left on failure, 24 h retention, active share kept, old leftovers removed, read-only grant, FileProvider paths and manifest) | **48/48 pass** |
| Phase 4 review fixes (`06004a0`) | JVM +11: share launch failures delete the copy (URI, activity, receiver), success keeps it 24 h, failing cleanup keeps the original error; export `"wt"` with fallback, unknown size refused untouched, unopenable destination cleaned up; close-time `IOException`; `importAll` continues after failures; key never created when files can't be listed; `hasAnyFile` fails closed; AVIF not taken for HEIF. Jest +5: Save disabled during import (document and card), no second selection while one runs, failed import unblocks Save, leaving during an import deletes late files | **JVM 59/59, Jest 347/347** |
| KeyVault hardening (`04c4605`) | JVM +5 `JsKeyAccessTest`: only `database` allowed; `attachments`, `reminders`, unknown and malformed ids rejected; the three JS key operations go through the check; native code keeps its own keys. Instrumentation: + `nativeCodeKeepsAccessToAttachmentsAndRemindersKeys` (compiled, **not run**) | **JVM 64/64, Jest 347/347** |
| UTF-8-safe export names (`6786ceb`) | JVM +8 `ExportFileNamesTest`: byte limit, extension kept, code-point-safe cut, exact and one-over boundary, no-extension, hidden and empty names, overlong extension, lone surrogate, a real share copy on disk, Share and Save a copy use the same helper | **JVM 72/72, Jest 347/347** |
| Phase 4 corrective work (third review) | Jest 355/355 in 21 suites (+2 `openStorage`: files kept when the database is created, now and on the next launch, and never for an existing one; +2 `database`: `beforeCreate` runs only before creating, and a failure creates neither key nor file). JVM 106/106 in 14 classes: + `AttachmentCleanupTest` 13 (M1, M2), `ModuleTasksTest` 6, `JsVaultTest` 5, an `Error` case each for export, share, views and import; source-text tests removed (`SafeSubmitTest` 1, `JsKeyAccessTest` 2, `ExportFileNamesTest` 1, part of a `ShareFilesTest` case) and replaced by behaviour tests. Each fix was removed once on purpose and its test failed. Follow-up: + `AttachmentViewsTest` 1 (a failed open, by an `Error` or a `StoreException`, releases the name it reserved: a later file under that name is removed by `purgeInactive`, and a retry opens and is held); without the release it fails | **Jest 355/355, JVM 107/107** |
| F9 database lifecycle | Jest 370/370 in 22 suites. `openStorage` +5: roots mounting together share one initialization, connection and repositories; a later root loads its own data and initializes nothing; a failure after opening closes the connection after its queued statements; Retry opens a fresh one; a failing attempt is joined, never replaced, and doesn't clear its successor. `migrations` +3 on two real connections to one file: a step another connection completed is skipped (schema and an interval reminder unchanged), a control shows a deferred transaction still reads the old version, and while another connection runs a step this one fails without running one. `serialDatabase` +2 (`closeWhenIdle` order, options passed on), new `opSqliteAdapter` 5 (`BEGIN IMMEDIATE` first, rollback keeps the original error, failed `COMMIT` rolls back, no lock runs nothing, default unchanged). Each fix removed once on purpose fails a test, except the check that only the failed attempt clears the slot: no path can replace the slot while an attempt is failing, so that check is defensive | **Jest 370/370, JVM 107/107** |
| Real SQLCipher, schema v2 → v3 (Phase 4 step 8) | 4 checks with op-sqlite's SQLCipher 4.19.0 source compiled for macOS: the v2 file is encrypted and needs its key; migration keeps every row with a verified snapshot and passes integrity, foreign-key and cipher checks; an injected v3 failure rolls back to the intact v2 file; an untouched copy keeps its SHA-256 (§5) | **4/4 pass** (one-off harness, not in the repository) |
| Phase 6 Step 2 (backup creation, Check backup) | JVM `com.trezor.app.backup` 85 in 8 classes (Step 1's 49, + `BackupServiceTest` 24 on a real `AttachmentStore` with TZA files and an in-memory destination that fails where asked: written, read back and checked, no attachments, key unavailable, body unchanged with only the DEK rewrapped, missing/damaged/mismatching/other-key files fail before any byte, refused destinations untouched, write/`fsync`/close failures and wrong or unknown final size delete the file, undeletable file reported, damaged read-back, gate deferral and release on failure, one session, password and space checks, Check failures and cleanup, startup cleanup, 25 MiB accepted and over the limit refused; `BackupGateTest` 5; `BackupFilesTest` 7). Jest +25 `backup.test.ts` (real export and artifact checks on the SQLCipher fake, extended with `location`, `:memory:` and cipher settings: flow order, rows from the export, gate makes queued writes wait, failures release it and abort, attachment error details, destination outcomes, manifest mismatch, wrong key, export failure detaches, FK violation, cipher settings, SQLCipher 3, integrity, schema, schema version; Check result, cancel, password, mismatch, error text). Real SQLCipher 4.19.0 (one-off harness, run in band with the Phase 4 check): export with foreign keys on, every B.4 check, all rows and `user_version` 3, SQLCipher 4 defaults, no header or plaintext in the file, live key refused, damaged page corrupt, other schema inconsistent, `createBackup` end to end | **JVM 85/85 backup, Jest 416/416, real SQLCipher 6/6 (+ Phase 4's 4/4)** |
| Phase 6 Step 3 (restore preparation, without the swap) | JVM +35 in 7 new classes and 1 extended: `RestoreServiceTest` 9 (real backups from `BackupService` restored on a device with another key: every step, `S_att` readable only with the target key, quarantine link, schedule saved and restored, live files byte-identical; zero attachments; wrong password, short password and too little space write nothing; changed backup → `BACKUP_CHANGED`; damaged and truncated sections; a failing cleanup keeps the journal → `RESTORE_RECOVERY_RETRY`; a journal blocks; every §8.1 precondition), `RestoreJournalTest` 4, `RestoreFileOpsTest` 4, `QuarantineTest` 5 (`kept-ids` absent, valid with a missing file, damaged → all, unlistable root, no overwrite), `AttachmentLocationsTest` 3, `ScheduleRestoreTest` 7 (order, every `scheduleSaved` case, idempotence, failed re-arm keeps the copy, the `ScheduleStore` monitor held throughout), `RestoreGateAndRestartTest` 2, `ShareFilesTest` +1. Jest +16: `restore.test.ts` 13 (step order, `S_db` under the device key with the settings rewrite, invalid settings and unreadable live settings, error-screen mode, queued writes and reconciles wait, shares wait/cancel, a failure at every step undoes and releases, schema and manifest mismatch, failed cleanup reported, wrong password, error-code entries), `reconcileGate.test.ts` 3. Real SQLCipher 4.19.0 harness +2 (export to the device key, settings rewrite and §B.4 on `S_db`; keys not interchangeable, files encrypted), run in band with Step 2's 6 and Phase 4's 4 | **JVM 262/262, Jest 432/432, real SQLCipher 12/12** |
| Step 3 review corrections (M1, L1, L3) | JVM `RestoreServiceTest` +6 (a failed re-arm keeps journal, saved schedule and staging, and a retry in the same session finishes; unknown and finished sessions refused; journal write failing before its rename and directory sync failing after it, both cleaned up; files without a journal never deleted or called done; earlier restore files block staging), and the failing-cleanup test now retries. Jest +3: `restore.test.ts` (3 tests replacing the one that expected the gates to be released: a failed cleanup keeps the native and reconcile gates held, runs no reconcile, refuses a new preparation, survives a second failure, and a successful retry releases native then reconcile gate then reconciles once; a failed gate release retried without repeating the cleanup; the release carries step 9's ids), `restoreReminderState.test.tsx` (app level: a reminder completed by step 9 stays completed after an edit; fails without the reload), `reconcileGate.test.ts` checks the release payload | **JVM 268/268, Jest 435/435, real SQLCipher 12/12** |
| Attachments verified before the destination is opened | `BackupServiceTest` +1 (a deletion requested while attachments are verified waits for the gate); the unreadable-attachment, key-unavailable and over-limit tests now also require that the destination was never opened, and the success test that it was opened once. With verification moved back inside the open destination, 6 tests fail | **JVM 86/86 backup** |
| JVM unit (automated) | `RecurrenceTest` (4) | **4/4 pass** |
| Android instrumentation after Phase 3 (automated, emulator API 37) | `KeyVaultTest` 12, `DatabaseFilesTest` 9, `ReminderSchedulerTest` 15 | **36/36 pass** |
| Android instrumentation after the exact-alarm change | + `withExactAlarmsAllowedEachOccurrenceIsOneExactAlarm` | **Not run** — emulator unusable; running it on the phone uninstalls the app |
| Android instrumentation (automated, emulator) | `KeyVaultTest` (12) against the real Keystore; `DatabaseFilesTest` (9): present/absent, unreadable location is an error not "absent", no-replace rename, temp-only delete, path rejection | **21/21 pass** |
| On-device self-test (debug, dev menu → "Run storage self-test") | 21 checks on real SQLCipher: active cipher; correct/wrong/missing key; native file guards; startup; foreign keys ON; failed migration leaves v1 with a verified snapshot; retry reuses it; migration keeps data; snapshot unreadable without key; invalid snapshot kept and a new one used; table rebuild keeps rows; violation rolls back; newer schema refused | **21/21 pass** |
| Manual upgrade test (emulator) | Data created with the Phase 1 release build (`06b022c`), then the Phase 1.1 debug build installed over it: data, theme and envelope intact; no migration, no snapshot, `trezor.db` unchanged on open; new writes and theme change persisted across restart | As expected |
| Manual (Phase 1, unchanged since) | First launch; create note/card/reminder; edit; delete; pin; complete; search; Done filter; Home counts, Pinned and Recently updated; theme; persistence across force-stop; missing-key error + retry; release installed over debug | All as expected |
| Manual on-disk inspection (Phase 1) | Raw `trezor.db`: no plaintext of entered data or schema; random header; host `sqlite3` refuses; envelope holds only the wrapped key | As expected |

Three kinds of automated tests, run separately:

| Kind | Where | Command | Runs on |
| --- | --- | --- | --- |
| Jest (21 suites) | `__tests__/` (storage on `node:sqlite`, app flows through `test-utils/appHarness.tsx`, native modules faked in `jest.setup.js`) | `npm test` | Node, no Android |
| JVM unit | `android/app/src/test/` (`attachments/` 8 classes, `reminders/RecurrenceTest`, `vault/JsKeyAccessTest`) | `cd android && ./gradlew :app:testDebugUnitTest` | Host JVM, no Android |
| Android instrumentation | `android/app/src/androidTest/` (`KeyVaultTest`, `DatabaseFilesTest`, `ReminderSchedulerTest`) | `cd android && ./gradlew :app:connectedDebugAndroidTest` | Emulator or device; **uninstalls the app afterwards, erasing its data** |

Also run `npx tsc --noEmit` and `npm run lint`. **No instrumentation test was
run in Phase 4.** The new instrumentation case is compiled only.

---

## 10. Deviations from the Phase 1 proposal

| Proposal | Implemented | Why |
| --- | --- | --- |
| `getOrCreateDatabaseKey()` | Separate `hasKey` / `createKey` / `getKey` | A combined call could silently create a new key for an existing DB |
| `ItemRepository` with `get`, `setPinned`, `setReminderCompleted` | `listAll` / `save` / `delete` | The provider already holds all items; fewer write paths to keep atomic |
| `rev` column per item | Not added | No consumer yet; add with sync/merge |
| Pre-migration copy of the DB file | Encrypted `sqlcipher_export` snapshot | JS has no file API; SQLCipher's export keeps the copy encrypted |
| `cipher_integrity_check` on every open | `quick_check` every open; full `cipher_integrity_check` before migrations | Cost grows with DB size |
| Recovery screen with "Start fresh (erase)" | *Try again* only | Phase 1 rule: never delete data as recovery. A deliberate, confirmed erase can come with backup and restore |
| Debug sample data | Separate in-memory repository, debug builds only | Guarantees sample data never touches real data |
| — | `dataExtractionRules` and `fullBackupContent` excluding everything | `allowBackup="false"` alone doesn't stop Android 12+ device transfer |
| — | `KEY_ALREADY_EXISTS`, `ENVELOPE_UNSUPPORTED`, `STORAGE_ERROR` codes | Needed for exact failure handling |

`minSdk` stays **24**. No dependency required raising it.

### 10.1 Phase 1.1 corrections (audit follow-up)

| Audit finding | Correction |
| --- | --- |
| M3 Foreign keys ON during migrations (cascade on table rebuild) | Foreign keys OFF outside the transaction, `foreign_key_check` before commit, ON again in `finally` (§6.3) |
| L2 Foreign-key check after commit / on every launch | Moved inside each migration transaction |
| M2 Partial snapshot trusted by file name | Temp file → close → reopen and verify (decrypt, cipher, `quick_check`, version, identical content) → no-replace rename; invalid snapshots never trusted or deleted (§6.2) |
| M1 Key retained in op-sqlite's options closure; docs overstated mitigation | Key removed from the options object after `open()`; §4.3–4.4 rewritten to describe actual lifetimes |
| L3 Writes outside the item queue could join another transaction | `serializeDatabase` for every statement on the shared connection (§7) |
| L1 Any open error treated as "file absent" | Native `DatabaseFiles.state()` with definite answers; `DATABASE_STATE_UNKNOWN` otherwise; never leads to key creation |
| L5 No key-format check | `^[0-9a-f]{64}$` enforced before use (`INVALID_KEY_FORMAT`) |
| L9 Stale doc reference in `TrezorVaultModule` | Updated |

Database format and schema version are **unchanged** (v1). Existing Phase 1
databases open without any migration **[verified: upgrade test]**.

New error codes: `DATABASE_STATE_UNKNOWN`, `INVALID_KEY_FORMAT`,
`SNAPSHOT_FAILED`. They are mapped to the existing error-screen messages; no new
UI.

---

## 11. Dependencies

| Dependency | Version | Scope | Purpose |
| --- | --- | --- | --- |
| `@op-engineering/op-sqlite` | **19.0.3** (exact) | app | SQLite + SQLCipher 4.19.0, OpenSSL 3.3.2 (`io.github.ronickg:openssl:3.3.2-1`, pulled by op-sqlite) |
| `androidx.test.ext:junit` | 1.2.1 | androidTest only | Instrumentation test runner support |
| `androidx.test:runner` | 1.6.2 | androidTest only | Instrumentation test runner |
| `junit:junit` | 4.13.2 | JVM unit tests only (Phase 3) | Runs the JVM tests (recurrence, attachments); not packaged in the app |
| `androidx.activity` / `androidx.core` | Compiled against 1.7.0 / 1.13.0; the release ships 1.8.1 / 1.17.0. Both come with React Native and other libraries | app, used directly since Phase 4 | Photo Picker and document contracts; `FileProvider` for Share. Not declared in `build.gradle`, so the versions follow React Native; the APIs used exist in all of them |

No new JS runtime dependencies besides op-sqlite. Phase 3 adds no runtime
dependency (reminders use only Android framework APIs). Phase 4 adds none
either: `PdfRenderer`, `javax.crypto`, the Storage Access Framework and the
two AndroidX libraries above were already in the app, and zooming uses RN's
`PanResponder`. It adds no permission, only a non-exported `FileProvider`. The vault uses only
platform APIs (`AndroidKeyStore`, `javax.crypto`, `SecureRandom`, `org.json`).

---

## 12. Known issues and risks

| Risk | Status / mitigation |
| --- | --- |
| **Key loss = data loss.** Uninstall, "Clear storage" or Keystore loss make data unrecoverable | By design until encrypted backup exists. The error screen warns against uninstalling |
| Database key passes through JS (§4.4) | No longer retained by op-sqlite after `open()`; still present until GC in immutable JS/Java/C++ strings that can't be zeroed; never logged |
| No automatic restore from snapshots; snapshots and crashed-attempt temp files are never cleaned up (audit L7) | Manual-recovery artifacts only. Retention, cleanup and restore belong to the backup phase |
| Search reads all items per query (debounced), then matches in JS | Fine at personal-organizer scale; a normalized search column or FTS would need a schema change if data grows large |
| Without "Alarms & reminders" (default for new installs on Android 13+), timing is approximate | Up to 10 min late while awake, ~1 h in Doze, and indefinitely while Samsung Freecess keeps the app frozen (§13.6). Trezor explains once and links to the setting from the editor and Settings |
| Force-stop and other OEM "app killers" | Force-stop removes all alarms until the app is opened again; some OEMs behave like force-stop (§13.8) |
| Reminders tested on one physical device only (Galaxy A53, Android 16) and the API 37 emulator | Not tested on API 24–33; see the manual checklist |
| Reboot re-arming verified with approximate alarms only | Repeat with exact alarms; if Android drops `BOOT_COMPLETED`, alarms stay unarmed until the app is next opened |
| Shared connection is serialized; calling the outer database from inside a `transaction()` callback would deadlock | Repositories use only `tx`; documented in `serialDatabase.ts` |
| StrongBox fallback only on `StrongBoxUnavailableException`; other StrongBox failures make the first launch fail, and software-backed keys are accepted silently (audit L4) | Untested on hardware; review with real devices |
| op-sqlite enables `load_extension` on every Android connection (audit L6) | Not exploitable with static or parameterized SQL; needs an op-sqlite option or patch |
| OpenSSL 3.3.2 (to our knowledge, past end of support) and no Gradle dependency verification or wrapper checksum (audit M4) | Planned with release hardening |
| Dev-only self-test reuses the production key id and could create it on a fresh install; a failed `listAll` after open leaks a connection on retry (audit L8) | Debug-only / minor |
| Emulator Keystore is software-backed | Hardware backing depends on the device; untested on real hardware |
| op-sqlite small maintainer base, frequent majors | Exact pin; driver isolated behind `SqlDatabase` |
| Third-party OpenSSL Maven artifact | Supply-chain dependency. **Not yet done:** Gradle dependency verification (checksums) |
| APK +20 MB universal (+6.6 MB per arm64 device) | Ship AAB / ABI splits before release |
| Release still signed with the template debug key; R8 off | Must be fixed before any distribution (`keystore.properties` is git-ignored) |
| Sample-data module bundled (unreachable) in release | Low risk; could be excluded with a Metro resolver rule later |
| Only tested on one emulator (API 37). Not tested on API 24–33 or real devices | Test on low-API and StrongBox devices before release |
| Opening view uses the system theme; with a forced dark theme on a light system, startup shows a light background for a moment | Cosmetic. The native launch window can't know the in-app preference |
| App-level TurboModule codegen: a stale native CMake cache (`android/app/.cxx`) can leave the module unregistered after adding the spec | One-time; fixed by deleting `android/app/.cxx`. Noted for contributors |
| `connectedDebugAndroidTest` uninstalls the app | Test-only; local data on the test device is lost |
| **Phase 4 not run on a device.** Pickers, content URIs, the `attachments` key in the real Keystore, view files with Fresco, `PdfRenderer`, the save-to picker, FileProvider grants and receiving apps are untested on hardware; `PdfViews` and the Android glue have no automated test | JVM and Jest cover the logic around them (§14). Device testing needs approval, because installing upgrades the user's real data to schema v3. Instrumentation tests are deferred |
| Password-protected PDFs | Not supported: "PDF is password-protected" (no password entry). Save a copy and Share still work |
| HEIC/HEIF photos | Decoded only on Android 9+ (minimum is Android 7); older versions say the photo can't be shown. Save a copy and Share still work |
| EXIF metadata | Originals are kept exactly, including EXIF data such as GPS location; Share and Save a copy pass it on. No warning is shown |
| Share copies may vanish early | Kept up to 24 h in `cacheDir`, which Android may clear sooner under storage pressure; a receiving app that reads late may then find nothing |
| Incomplete exports | Some document providers refuse `deleteDocument`; the user is told an incomplete file may remain |
| PDF viewing | No zoom; very large PDFs open slower (every page size is read on open); pages are rendered at screen width |
| Image zoom runs on the JS thread | `PanResponder`, no inertia, no animated double-tap; may feel less smooth on slow phones |
| Share copies outlive 24 h if Trezor isn't reopened | Expired copies are purged only at startup or on return to the foreground (no background job). They stay in the private cache, which Android may also clear |
| Long non-ASCII export names | **Fixed (`6786ceb`):** Share and Save a copy names were limited to 120 UTF-16 characters, so a long CJK name exceeded the 255-byte file-name limit and Share always failed. Now at most 200 UTF-8 bytes (§14.9) |
| Second Phase 4 review, open (Low) | (1) **Fixed:** the attachments directory is now `fsync`ed after the import rename, and an import whose sync fails is undone (§14.3). (2) **Fixed:** records `parsePickResult` rejects are reported as `IMPORT_FAILED` and their files deleted at once (§14.2). (3) **Fixed:** every task goes through `SafeSubmit` (now inside `ModuleTasks`, which owns the module's executors). After `invalidate()` a refused submission rejects its promise with `IO_FAILED`, and work already accepted still runs (`shutdown`, not `shutdownNow`). `invalidate()` is idempotent **[verified: JVM, incl. a shutdown racing with submissions]**. Not covered: a Save a copy or picker promise whose activity result never arrives because the module was torn down while the system picker was open (the JS context that awaited it is gone too); the module lifecycle itself has no automated test (instrumentation). Informational: one worker serializes imports with viewing and export; card thumbnails decrypt the whole file per mount; files picked in debug sample-data mode stay until startup cleanup |
| Phase 4 review findings | Fixed in the review-fix commit (`06004a0`): a failed share deletes its copy at once; exports use `"wt"` and refuse destinations of unknown size; a stream that fails on close is a per-file failure; Save waits for imports; the key is never created when files can't be listed; AVIF is no longer taken for HEIF (§14) |
| Export to providers that don't report a size | Refused with `DESTINATION_UNVERIFIED` (fail closed). Which real providers do this is unverified. The empty document the picker created may remain, and the user is asked to choose another location |
| JS access to vault keys | **Fixed (KeyVault hardening, `04c4605`):** `TrezorVaultModule.hasKey`/`createKey`/`getKey` accept only `database` (`JsKeyAccess`); `attachments`, `reminders` and any other id are rejected with `INVALID_ARGUMENT` before the vault is touched (`JsVault`). Native code keeps using `KeyVault` directly, attachments and reminders through their fixed ids. **[verified: JVM]** with a recording vault for the rule, `JsVault`, `AttachmentKeys.of` and `ScheduleStore.keyFrom`; the module's one-line delegation to `JsVault` is not tested (instrumentation). Native access to the other keys through the real Keystore is an instrumentation test (compiled, not run) |
| Untrusted PDFs are rendered in-process | Android's `PdfRenderer` (PDFium) parses picked PDFs in Trezor's process, which can unwrap the attachments key. Accepted platform risk |
| Screen contents in Recents and screenshots (no `FLAG_SECURE`) | Android's Recents thumbnail shows the last screen, such as a note, a card number or a decrypted photo or PDF in the viewer, and screenshots and screen recording are allowed. `FLAG_SECURE` would block all three, but it would also stop users screenshotting a card for a cashier or a receipt to send, and it makes screen sharing show black. A narrower option on Android 13+ is `Activity.setRecentsScreenshotEnabled(false)`, which hides only the Recents thumbnail. Product decision pending; no change made |
| Device UI issues (Galaxy A53) | Tab bar overlap: **fixed in code (`8d728c3`)**. The bar's height and bottom padding now include the system navigation inset, and the Documents tab is labelled "Docs". Installed on the A53 (release build); not yet confirmed there by the user. The keyboard not opening for an auto-focused field is still unresolved (found during Phase 3 testing) |
| Third, independent Phase 4 review | (M1) **Fixed:** startup cleanup deleted every `.tza` file when the database had to be created because its file was missing; now they are recorded as kept before the database is created (§14.3). (M2) **Fixed:** startup cleanup ran on every React root mount; now once per process (§14.3). (L1) **Corrected in the docs:** the HEIF/AVIF check reads at most 12 compatible brands (§14.2). (L2) **Corrected in the docs:** tab bar row above. (L3) **Fixed:** an `Error` such as `OutOfMemoryError` in a native task now rejects its promise with `IO_FAILED` (`ModuleTasks`), instead of killing the process with the promise unsettled; share and view copies, PDF pages and descriptors, and partial exports are cleaned up on an `Error` too, and a pick that ends with an `Error` removes the files it already imported **[verified: JVM]**, except `PdfViews` (Android only, no JVM test). For `OutOfMemoryError` this is **best effort**: the JVM tests throw a simulated `OutOfMemoryError` with memory still available, while a real one may also break the rejection, the cleanup, the React Native bridge or the JS runtime, and the process may still be killed; recovery from running out of memory is not claimed. (L4) **Fixed:** tests that only matched Kotlin source text were replaced by behaviour tests against recording fakes (`JsVaultTest`, `ModuleTasksTest`, `AttachmentCleanupTest`, the shared export name in `ShareFilesTest`). What they can't reach is the one-line glue in the React Native modules (which method calls which helper); that needs instrumentation. The FileProvider test reads the source manifest; the merged manifest of the debug APK (checked with `aapt2`, not automated) has two providers, ours (not exported, authority `com.trezor.app.attachments`) and androidx.startup's `InitializationProvider` (not exported, no file paths). A second React root also opened a second database connection (the first was never closed); M2 no longer depends on that. Reviewed read-only afterwards (F9): each open is its own SQLCipher handle, closed only when JS garbage-collects it; no `busy_timeout` is set, so overlapping writes fail with `SQLITE_BUSY`; two opens during a pending migration can both run it (`user_version` is read outside the migration's transaction). **Fixed in a separate commit:** one initialization and connection per process, closed on a failed initialization, and `BEGIN IMMEDIATE` migrations that re-read the version (§6.3, §7). One owner for the connection is a precondition for backup and restore (Phase 6) |

---

## 13. Reminders and notifications (Phase 3)

### 13.1 Architecture

```
SQLCipher (source of truth)          JS                              Kotlin (com.trezor.app.reminders)
reminders table  ──readStored()──▶ reconcile() ──sync(entries)──▶ TrezorRemindersModule
                 ◀─completeFired──  ▲   │                            │
                                    │   └─getFiredOnceIds()◀──────── ScheduleStore  (encrypted record)
       RemindersProvider: on change (300 ms debounce),                ReminderScheduler (AlarmManager)
       on launch, on return to foreground                             ReminderNotifications (channel "reminders")
                                                                      ReminderAlarmReceiver / ReminderRestoreReceiver
                                                                      ReminderTaps ──event "trezorReminderTap"──▶ RootNavigator
```

- The encrypted database is the only source of truth. The native record is an
  **operational copy**: `sync` replaces it entirely from the database, so it can
  always be rebuilt and is never read back as data.
- Reconciliation (`src/reminders/scheduler.ts`): (1) ONCE reminders the system
  has fired are marked completed in the database (only if they still exist, are
  ONCE and not completed — a deleted reminder is never recreated); (2) the whole
  native schedule is replaced with the current database state. Runs are serial
  and coalesced. Every run gives the same result, so there are no duplicates or
  stale alarms **[verified: Jest, instrumentation]**.
- Each reminder has a fixed pair of `PendingIntent`s (data URI
  `trezor-reminder:<id>`, request codes 0 and 1), so re-arming replaces them.
  Each notification uses tag `reminder:<id>`, so a reminder shows at most one.
- No third-party notification library, no Firebase/FCM, no network. Only
  framework APIs (`AlarmManager`, `Notification.Builder`, `BroadcastReceiver`).

### 13.2 Recurrence semantics

Implemented twice with identical rules — `src/reminders/recurrence.ts` and
`Recurrence.kt` — and checked against the same 33 hand-computed cases in
`test-fixtures/recurrence.txt` **[verified: Jest + JVM]**.

| Mode | Rule |
| --- | --- |
| ONCE | Fires once at `due_at` (an absolute instant) |
| DAILY / WEEKLY | Same wall-clock time (`local_start`) every 1 / 7 days in the device's **current** zone |
| MONTHLY | Same day of month; if the month is shorter, the last day (31 Jan → 28/29 Feb → 31 Mar: the original day is kept, not drifted) |
| YEARLY | Same date; 29 Feb → 28 Feb in non-leap years |
| INTERVAL | `due_at + k × interval` (1, 2, 4, 8 or 12 h; stored range 15 min–30 days); absolute, unaffected by zone/DST |

- **DST gap** (local time doesn't exist): moved forward by the gap
  (02:30 → 03:30). **DST overlap** (occurs twice): the earlier instant.
- **Time-zone change:** calendar modes follow the new zone's wall clock
  (09:00 stays 09:00); ONCE and INTERVAL keep their instant.
- **Missed occurrences** (device off, Doze): never replayed in a burst. A
  recurring reminder continues with its next occurrence; INTERVAL keeps its
  rhythm (anchor + k × interval). A ONCE reminder whose time passed before it
  could be armed is not scheduled and shows as **Overdue** in the app.
- **States:** active ONCE in the future → armed; ONCE fired → marked completed
  on next reconciliation; ONCE in the past, not fired → Overdue, not armed;
  repeating → always armed with its next occurrence; completed → nothing armed;
  reactivated → repeating ones are armed again, a past ONCE stays Overdue (the
  editor requires a future time when a ONCE reminder is created, retimed, switched
  to ONCE or reactivated through edit).

### 13.3 Native schedule record

`noBackupFilesDir/reminders/schedule.bin` = `[12-byte IV][AES-256-GCM
ciphertext]`, AAD `trezor.reminder-schedule|1`. The AES key is a 32-byte random
key stored as a Keystore-wrapped envelope under key id `reminders` (the existing
`KeyVault`, §4; unchanged architecture). Contents: per reminder its id, mode,
start, local start, interval, the armed occurrence, and — **only when "Show
reminder details" is on** — title and description; plus the set of fired ONCE
ids. A missing, tampered or undecryptable file is treated as empty and rebuilt
by the next `sync` **[verified: instrumentation]**. The file is excluded from
backup like all app data.

It exists so alarms can be re-armed after reboot, update and clock changes
without opening the database (which needs JS).

### 13.4 Notification privacy

- Setting **Notification privacy → Show reminder details** (default off).
- Off: title "Trezor", body "You have a reminder." Reminder text is not even
  written to the native record.
- On: the reminder title and description (description omitted if empty).
  Notifications are `VISIBILITY_PRIVATE` with a generic `publicVersion`, so the
  lock screen shows the generic text unless the user allows private content in
  Android settings **[verified: emulator, both modes]**.
- Changing the setting re-syncs immediately; times are unchanged, only content
  changes **[verified: Jest, instrumentation]**.
- Nothing about reminders is logged; JS logs only error codes.

### 13.5 Permissions

| Permission | Why |
| --- | --- |
| `POST_NOTIFICATIONS` | Required on Android 13+ to show notifications. Asked once, after the user saves an active reminder, behind an in-app explanation ("Allow reminder notifications?" — Continue / Not now). If denied, Settings shows "Notifications are off" and opens Android settings |
| `RECEIVE_BOOT_COMPLETED` | Re-arm alarms after reboot (alarms don't survive it) |
| `SCHEDULE_EXACT_ALARM` | On-time delivery (§13.6). Granted automatically on Android 12; on Android 13+ off by default for new installs and allowed by the user in Android's "Alarms & reminders" page. After the first saved active reminder with notifications allowed, Trezor explains once ("Deliver reminders on time?" — Open settings / Not now). While it is off, the editor and Settings ("Reminders may be late") say so and link to that page. Android 11 and older need no permission |

Not requested: `USE_EXACT_ALARM` (Google Play reserves it for alarm-clock and
calendar apps, and the user can't revoke it), `FOREGROUND_SERVICE`, `WAKE_LOCK`,
`INTERNET` (release). `ReminderRestoreReceiver` is exported (system broadcasts)
and acts only on `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`,
`TIMEZONE_CHANGED` and `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` (sent
when the user allows exact alarms: everything is re-armed as exact);
re-arming is idempotent. Revoking the access stops the app and cancels its
exact alarms; the next launch re-arms them as approximate alarms.
`ReminderAlarmReceiver` is not exported. The notification tap intent is
explicit (`MainActivity`, immutable).

### 13.6 Delivery accuracy

**With exact alarms allowed** (always on Android 11 and older; on Android 12+
when "Alarms & reminders" is on), each occurrence is one
`setExactAndAllowWhileIdle(RTC_WAKEUP, t)` alarm: on time, in Doze too. The
second request code is cancelled, so an occurrence still has one alarm and one
notification. If the access is revoked between the check and the call
(`SecurityException`), the occurrence falls back to the approximate pair.

This replaced approximate-only timing (Phase 3 decision 2) after testing on a
Samsung Galaxy A53 (Android 16): Samsung's **Freecess** freezes an app that was
recently in the foreground once it is cached, and **defers its inexact alarms
until it is unfrozen** (`AlarmManager: Deferring alarm … due to freecess`). A
09:40 daily and a 10:00 interval reminder were held until 10:10:08, when the
user swiped Trezor from recents; nothing indicates the hold would have ended
sooner. With an exact alarm the same frozen process was unfrozen for the alarm
(`UFZ … reason: Alarm`) and notified at 11:15:00.07 for 11:15.

**Without exact alarms**, timing is approximate. Each occurrence is armed with
two inexact alarms; whichever fires first delivers it and the other is ignored
(it carries the same occurrence, which is no longer the armed one):

| Alarm | Behaviour |
| --- | --- |
| `setWindow(RTC_WAKEUP, t, 10 min)` | Within 10 minutes while the device is awake (Android's minimum window); deferred in Doze |
| `setAndAllowWhileIdle(RTC_WAKEUP, t)` | Fires in Doze too, but Android allows delay of up to 75 % of the lead time, capped at 1 h |

So a reminder arrives at its time or **up to ~10 minutes late** when the phone
is in use, and **up to about an hour late** when it is idle — on stock Android.
Vendor freezers can hold them longer (above). While exact alarms are off, the
editor says reminders may be late and Settings shows "Reminders may be late",
both linking to "Alarms & reminders". Observed: emulator 0:22, 2:26, 1:02 min;
A53 with the app not frozen 10:00 and 2:41 min; A53 frozen 30 min (Freecess).

An occurrence that is due but not yet delivered (inside its window) **stays
armed** across re-arming (clock sync, time-zone change, the app opening): the
alarm is re-set at the same past time and fires at once. JS keeps handing such
ONCE reminders to the native side for 75 minutes (`PENDING_GRACE_MS`); the
native side re-arms them only if that occurrence is still pending, and never
re-delivers a delivered one **[verified: instrumentation; emulator]**. (Found
during emulator testing: a network time sync at 10:35:20 had cancelled a
10:35 reminder still inside its window.)

### 13.7 Notification taps

Tap → explicit intent to `MainActivity` (`com.trezor.app.reminders.OPEN`,
extra `reminderId`) → `ReminderTaps` keeps it until JS consumes it →
`RootNavigator` opens the reminder's detail screen. Consumed on navigation ready
(cold start), on the `trezorReminderTap` event (running app) and on return to
foreground. A tap for a deleted reminder shows "Item not found" and recreates
nothing **[verified: Jest]**. Background and terminated (process killed) taps
**[verified: emulator]**.

`MainActivity` installs react-native-screens' `RNScreensFragmentFactory`, as
the library documents: without it, restoring the activity after the process was
killed in the background crashed on launch (found when tapping a notification
after the process had been killed; affected any such restore since Phase 0).

### 13.8 Lifecycle

| Event | Behaviour |
| --- | --- |
| Reboot | `BOOT_COMPLETED` → `rearmAll` from the native record. **[verified: Galaxy A53, Android 16, approximate alarms]**: the process started for `ReminderRestoreReceiver` 2.5 min after boot without the app being opened; a 09:25 reminder missed during the reboot notified once at 09:28:56 (both alarms of its pair fired, one notification). Not yet repeated with exact alarms. (On the API 37 emulator it could not be verified: system overload) |
| App update | `MY_PACKAGE_REPLACED` → `rearmAll` **[verified: emulator upgrade]** |
| Clock / zone change | `TIME_SET` / `TIMEZONE_CHANGED` → `rearmAll`; calendar modes follow the new zone **[verified: emulator, Belgrade ↔ New York]** |
| App launch, return to foreground | Full reconciliation from the database |
| Process killed by the system | Alarms survive; receivers start the process without UI |
| Force-stop (Settings → Force stop) | Android removes the app's alarms and blocks its receivers until the user opens it; opening the app re-arms everything. Not avoidable |
| OEM battery restrictions | Samsung Freecess defers inexact alarms of a frozen app until it is unfrozen; exact alarms unfreeze it **[verified: Galaxy A53, Android 16]**. Other vendors' "app killers" untested |
| "Alarms & reminders" allowed | `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` → `rearmAll` as exact alarms, without opening the app **[verified: A53, three reminders switched from pairs to one exact alarm each]** |
| "Alarms & reminders" revoked | Per Android, the app is stopped and its exact alarms are cancelled; the next launch re-arms approximate pairs. Not verified on a device |
| Notifications disabled / denied | Alarms still fire, Android drops the notification; Settings shows "Notifications are off" |
| Keystore or record unreadable in a receiver | Nothing shown; the next reconciliation rebuilds the record |
| Sample data (debug) | Never scheduled (only the real repository is reconciled) |

### 13.9 Phase 3 tests

| Kind | What | Result |
| --- | --- | --- |
| Jest | Recurrence fixtures in an `Intl` zone (Belgrade, New York, London), schedule helpers, entry building, privacy of entries, reconciliation (idempotence, fired ONCE completion, deleted reminders), queue, permission policy, migration v2 (preservation, constraints, rollback), repository fields × 6 modes, settings, editor validation, Home sorting, 17 app-level reminder flows | See §9 |
| JVM unit (`./gradlew :app:testDebugUnitTest`) | `RecurrenceTest`: shared fixtures, day numbers, invalid intervals, parsing | 4/4 |
| Instrumentation | `ReminderSchedulerTest` (15 + 1 exact-alarm test) on real AlarmManager, NotificationManager, Keystore | 15 passed on the emulator before the exact-alarm change; the new test compiles but has not run (the emulator is unusable, and the run uninstalls the app from the phone) |
| Jest | 6 app-level exact-alarm flows: one-time explanation (Open settings / Not now, persisted across restart), none with notifications off, editor caption and Settings row only when not allowed, pick-up on return to the app | Pass |
| Emulator (manual) | Upgrade Phase 2 release → Phase 3 with data; delivery generic and detailed; taps from background and killed process; zone change | As expected (see the Phase 3 report) |
| Physical device (Galaxy A53, Android 16, release build) | Reboot re-arming without opening the app; missed occurrence once after boot; no duplicates from the alarm pair; cold-start tap; daily and interval re-arm; Freecess delay of approximate alarms; update in place keeps data; "Alarms & reminders" grant re-arms as exact; exact alarm on time while frozen | As expected, apart from the Freecess delay that led to exact alarms |

## 14. Attachments (Phase 4)

Encrypted files for card photos and document attachments. The metadata is in
SQLCipher (schema v3, §5); the bytes are in the app's no-backup directory.

### 14.1 Files and keys

- `noBackupFilesDir/attachments/<id>.tza`, one immutable file per attachment
  (`AttachmentStore`). Imports are written to `tmp/<id>.part`, synced, decrypted
  back and checked, then renamed into place.
- Format TZA v1 (`AttachmentFormat`): a random 256-bit key per file, wrapped by
  the KeyVault `attachments` key; content in 64 KiB AES-256-GCM chunks whose
  nonces carry the chunk index and a last-chunk flag, so truncation,
  reordering and moving a file to another id are detected.
- The `attachments` key is created only while no attachment file exists. If it
  is missing while files exist, nothing is created or deleted, and picking
  fails with `KEY_UNAVAILABLE` (`AttachmentKeys`) **[verified: JVM]**.
  `AttachmentStore.hasAnyFile` fails closed. A store directory that exists
  but can't be listed, or isn't a directory, throws instead of answering "no
  files", so no key is created over files that can't be seen
  **[verified: JVM]**.

### 14.2 Native module `TrezorAttachments`

- `pick(source, imagesOnly, maxCount)`: `photos` opens the Photo Picker
  (`PickVisualMedia`, images only); `files` opens the system document picker
  (`ACTION_OPEN_DOCUMENT` with the supported types). Neither needs a storage
  permission; the picked URIs are read once and not kept.
- Each file is imported on one background worker. The type is taken from the
  first 64 bytes (JPEG, PNG, WebP, HEIC/HEIF, PDF). For HEIF the major brand and
  the compatible brands within those 64 bytes are read (at most 12). AVIF is
  refused as unsupported even when its major brand is the generic
  `mif1`/`msf1` **[verified: JVM]**, but only if `avif`/`avis` is among the
  brands read: a file that lists it after the 12th compatible brand is stored
  as `image/heif`. The name and type the
  providing app declares do not decide it, so a renamed file can't pass as
  another type. Over 25 MB is refused while reading, even if the declared size
  is wrong. Names are reduced to their last segment, without control or
  bidirectional characters, at most 120 characters, and get an extension if
  they have none **[verified: JVM]**. That is the stored display name; copies written outside the store are also limited to 200 UTF-8 bytes (§14.9).
- One file's failure, including an `IOException` when closing its stream,
  becomes that file's `READ_FAILED` or `IMPORT_FAILED`. Its encrypted file is
  removed, and the other picked files are still imported. Every pick promise
  settles **[verified: JVM]**.
- The result is JSON metadata only (`{ imported, failed, skipped }`); file
  bytes never reach JavaScript. Per-file failures: `TOO_LARGE`,
  `UNSUPPORTED_TYPE`, `READ_FAILED`, `IMPORT_FAILED`. Whole-call rejections:
  `BUSY`, `NO_ACTIVITY`, `PICKER_UNAVAILABLE`, `KEY_UNAVAILABLE`,
  `INVALID_ARGUMENT`.
- **Records JS rejects:** a record that fails `attachmentRecordProblem`, or
  repeats an accepted id, is not added to the draft. `parsePickResult`
  reports it as that file's `IMPORT_FAILED` (shown like any other failed
  file), and `pick` deletes its encrypted file at once **[verified: Jest]**.
  - Only a well-formed attachment id that no accepted or other record of the
    same result uses is deleted. A malformed value can't name another file.
  - Native import never overwrites an existing file, so such an id is a file
    this pick created, never a saved attachment or another draft's file.
  - If the delete fails, a code is logged and the file is left for the
    startup cleanup. The user has already been told the file wasn't added.
  - Kotlin and TS apply the same limits today, so a valid import is never
    refused; this guards against future drift.
- `deleteFiles(ids)` (idempotent), `keepUnreferenced()` and
  `collectGarbage(knownIds)` (§14.3), plus
  `openView`/`closeView`, `openPdf`/`renderPdfPage`/`closePdf`,
  `purgeInactiveViews` (§14.4, §14.8), `saveCopy`, `share` and
  `purgeExpiredShares` (§14.9).
- Nothing is logged except error codes.

### 14.3 Crash safety and cleanup

- **Order of operations:**
  1. A file is encrypted to `tmp/<id>.part`, `fsync`ed, decrypted back and
     checked, then renamed to `<id>.tza`. The attachments directory is then
     `fsync`ed (`DirectorySync`: `android.system.Os.fsync` on the device).
     All of this happens **before** the row that refers to it is saved.
     - If the directory sync fails, the import is undone and reported
       (`IO_FAILED`), so no row can refer to a file whose name isn't known to
       be durable **[verified: JVM]**.
     - `tmp/` isn't synced: a stale `.part` that reappears after a crash is
       removed by the startup cleanup.
  2. The database transaction decides which item owns which attachment.
  3. Files are deleted only **after** the transaction removing their rows
     has committed.
- **What can and can't go wrong:**
  - A crash or kill can leave an unreferenced file, which the startup cleanup
    removes.
  - Database and file system are still not one atomic unit. The file and its
    directory entry are durable before the row commits, so a power loss can
    leave an unreferenced file, but not a row without its file, on storage
    that honours `fsync`.
  - Storage that loses synced data could still lose a file. The startup
    cleanup removes unreferenced files but cannot recreate a missing one; the
    viewer then shows "File is missing".
  - The Android `Os.fsync` path has no automated test (it needs a device);
    the JVM tests run the same logic against the host file system through
    `java.nio`.
- At startup, after the database opened and before any screen can pick a
  file, `openStorage` passes the database's attachment ids to
  `collectGarbage`. It removes unreferenced `.tza` files and unfinished
  imports, and leaves other files alone. A failure is logged as a code and
  retried next launch. If the database cannot be opened, nothing is removed
  **[verified: Jest]**.
- **Once per process** (`AttachmentCleanup`). Removing files without a row
  is only safe while no import awaits its row. If the Activity is recreated
  while the process and the JS runtime live on, a second React root runs
  `openStorage` again; its `collectGarbage` only purges expired shares and
  resolves with -1. Files the first tree imported but hasn't saved yet, and
  its open views, stay. The claim is taken before any work, so a failed
  cleanup is retried by the next process, not by a later root
  **[verified: JVM, incl. concurrent calls]**. Whether RN 0.88 keeps the JS
  runtime across Activity recreation is not verified on a device; the rule
  holds either way.
- **Never over a database that had to be created.** If the key exists but
  `trezor.db` is missing, the database is created again (§6.1). The `.tza`
  files may then be all that is left of the original (still decryptable with
  the existing key), so `openTrezorDatabase` runs `beforeCreate` first: the
  native `keepUnreferenced()` records every stored id in
  `attachments/kept-ids` (ids only; synced, renamed, directory synced) before
  the database file (and, on a first launch, the key) is created. `collectGarbage` never removes a
  kept id, on this or any later launch; the record only grows. If it can't be
  written, or the store directory exists but can't be listed, nothing is
  created and the error screen shows `STORAGE_ERROR`. If
  it can't be read, garbage collection removes only `.part` files and fails
  with `IO_FAILED`. Kept files still count for the key rule (§14.1)
  **[verified: JVM, Jest]**. They are manual-recovery material like
  snapshots: nothing deletes them yet (delete-all, Phase 7, will). A genuine
  first launch has no files, so nothing is written.
- Files picked for a draft that is then discarded are deleted at once by the
  editor session (§14.5). Only a crash or a killed process leaves them for
  the startup cleanup.
- If the process is killed while a picker is open, nothing is imported.

### 14.4 Showing photos

- `openView(id, size, sha256)` decrypts the whole file into
  `cacheDir/attachments/view/<32 random hex>.view` and checks it against the
  database record. Only then does it return a `file://` URI for RN `Image`
  (`resizeMethod="resize"`, so decoding happens at display size). The copy is
  written as `.part` and renamed, so `Image` never reads a partial file.
- `useAttachmentView` deletes the copy (`closeView`) when the screen showing
  it unmounts or the attachment changes. `collectGarbage` at startup deletes
  any left over. `closeView` refuses paths outside the view directory
  **[verified: JVM]**.
- **Without the database too** (audit L2): the module's first task on its
  worker, queued when the module is created, removes view copies, PDF copies
  and rendered pages an earlier process left (`AttachmentCleanup.atModuleStart`,
  once per process). JS creates the module when its bundle loads, before the
  database opens, so this runs even when opening fails (a missing key, a
  damaged file), and before any view of this process exists. It deletes only
  files in the view directory that no screen holds (`purgeInactive`, so a copy
  being written is kept) and share copies older than 24 hours
  (`ShareFiles.purgeExpired`; active and recent shares stay, Corrective D),
  never `.tza` files; a directory that can't be listed removes nothing
  **[verified: JVM; the module glue and the creation time are not verified
  on a device]**.
- Random names mean the image memory cache never reuses a copy. Fresco keeps
  decoded bitmaps in memory only, and its disk cache is for network images,
  not local files. This is from Fresco's design and has not been checked on a
  device.
- Missing or damaged files show "Photo file is missing" or "Photo file is
  damaged" in the tile. The rest of the item keeps working **[verified: Jest]**.
- HEIC/HEIF photos decode only on Android 9+ (the app's minimum is Android 7).
  Older versions show "This photo can’t be shown on this device".

### 14.5 Editor sessions

`useAttachmentSession` (`src/screens/editor/attachmentSession.ts`) owns the
files picked while one editor is open **[verified: Jest]**:

| Event | Files |
| --- | --- |
| Pick | Imported now and owned by the session. While a pick or its import runs, Save is disabled and "Adding files…" / "Adding photo…" is shown, so an item is never saved without files the user chose **[verified: Jest]**. The busy flag is cleared just before the editor adds the files to the draft. Both are state updates in the same async continuation, which React batches; a Save in between is not expected but isn't excluded by construction |
| Replace or remove a photo picked in this session | Deleted at once (no row refers to it) |
| Replace or remove a stored photo | Kept until the save that drops it commits, then deleted by `ItemsProvider` |
| Save | The session's files that the item keeps now belong to it; the others are deleted |
| Cancel, Discard, back | Every session file is deleted; stored files are untouched |
| A pick that finishes after the editor closed | Deleted, not added |
| The save's write fails | Stored files are kept; the session's new files become orphans for the startup cleanup |
| App killed while editing | Orphans, removed at the next startup |

### 14.6 Cards (Phase 4 step 4)

- The editor has Card name, Issuer, Card number, Card photos (front and back,
  each optional: add, replace, remove), Cardholder and Notes. Photos come from
  the Photo Picker, images only, one at a time.
- No barcode or QR graphic is shown anywhere. The detail screen shows the
  number as text with "Card number · No barcode saved". The code type choice
  and its detail row are gone. The stored `code_format` is kept unchanged on
  edit, and new cards still get the default `barcode` **[verified: Jest]**.
- The list shows "Issuer · •••• 1234" when an issuer is set.
- Picker problems are explained under the photos: too large, not a supported
  photo, unreadable, couldn't be saved, key unavailable, no picker. Nothing in
  the draft changes.

### 14.7 Documents (Phase 4 step 5)

- Every document type (receipt, warranty, image, document) can have up to
  10 attachments, photos or PDFs, kept in the order shown.
- **Editor:**
  - "Add photos" opens the Photo Picker (images only); "Add files" opens the
    document picker (images and PDFs);
  - both pick several files at once, at most the number still free, and are
    disabled at 10;
  - each file's ⋮ menu offers Move up, Move down, Replace (one photo or PDF,
    same position) and Remove.
- **Lifecycle:** the same session rules as card photos (§14.5), verified for
  documents as well **[verified: Jest]**.
- **Partial imports:** the files that worked are added. Each failure is
  explained under the list, and files beyond the limit are reported ("2 files
  weren’t added …"). `validate` also refuses more than 10.
- **Detail screen:** each file shows its name with its type and size ("PDF ·
  1.2 MB", "JPEG image · 340 KB") and opens the viewer (§14.8). No file is
  decrypted to show the list, so a missing or damaged file shows up only when
  it is opened.
- Dates, expiry, merchant, amount, currency and notes and their validation
  are unchanged **[verified: Jest]**.

### 14.8 Viewer (Phase 4 step 6)

`AttachmentViewer` (`src/screens/AttachmentViewerScreen.tsx`) opens from a
card photo or a document's file row. It pages through the item's files with
Previous/Next (a card's front and back; a document's files in order) and
shows "2 of 3 · PDF · 1.2 MB · Page 1 of 4". Only the current file is open:
switching or closing deletes its copy **[verified: Jest]**.

- **Images**: `ZoomableImage` is built on RN `PanResponder` and `Animated`,
  with no new dependency. Pinch zooms 1–4× around the fingers, one finger pans
  only while zoomed and never past the edges, and double-tap toggles 2.5×. The
  math is in `zoom.ts` **[verified: Jest]**. The image is laid out at twice
  the view size and scaled down, so it is decoded sharp enough for zooming.
  An image Android can't decode shows "Image can’t be shown".
- **PDFs**: `PdfViews.kt` opens the checked, decrypted copy with
  `android.graphics.pdf.PdfRenderer`. Pages are listed with their sizes and
  rendered one at a time, on a dedicated thread, at the screen's pixel width
  (at most 2048 px and 4 MP), into PNG view files on white. The vertical
  `FlatList` renders only pages near the screen, and each page's file is
  deleted when its row is recycled. Closing the viewer closes the renderer and
  deletes the PDF copy and every page **[verified: Jest]**.
  - A PDF that needs a password (`SecurityException`) shows "PDF is
    password-protected". One the renderer rejects shows "PDF can’t be shown",
    and one page that fails shows "This page can’t be shown" while the others
    still show.
- **Cleanup**: `AttachmentViews` tracks the files it handed out. When the app
  returns to the foreground, `purgeInactiveViews` deletes view files nothing
  holds, and the startup cleanup deletes all of them **[verified: JVM, Jest]**.
- **Errors** are messages for a normal user: missing, damaged, key
  unavailable, protected, unsupported or undisplayable. Nothing crashes, and
  the item stays usable.
- There is no external viewer, no `Intent` to other apps and no network. The
  TZA format and the database are unchanged.

### 14.9 Save a copy and Share (Phase 4 step 7)

Both are buttons in the viewer, for the file shown. Neither changes the
encrypted original, the TZA format or the database **[verified: JVM, Jest]**.

**Save a copy** (`AttachmentExport`):
1. The attachment is checked completely (size and SHA-256) before anything
   else. A missing or damaged file, or a missing key, is reported without
   opening a picker.
2. `ACTION_CREATE_DOCUMENT` (the system "save to" picker) is suggested the
   original name and type. The user picks the folder and name. The picker
   creates a new document: it never replaces an existing file, and a name
   that's taken gets a number.
3. The attachment is decrypted straight into the document's output stream,
   so there is no plaintext file in between. Each chunk is authenticated, and
   size and SHA-256 are checked again at the end.
- A destination that already has content is refused and left untouched
  (`DESTINATION_NOT_EMPTY`) **[verified: JVM]**.
- **`DESTINATION_UNVERIFIED`:** if the provider doesn't report the
  destination's size (no `OpenableColumns.SIZE`, or the query fails), the
  export is refused before anything is opened **[verified: JVM]**.
  - The destination is **not deleted**: it could be an existing file. So the
    empty document the picker created normally stays where the user chose.
  - The UI says so: "This location can’t confirm the file is new, so nothing
    was saved. An empty file may remain there. Choose another location."
- The stream is opened with `"wt"` (write and truncate). Only a provider that
  rejects `"wt"` gets `"w"`, and only after the destination was shown to be
  empty **[verified: JVM]**. Providers differ: these rules cover the providers
  that report sizes and honour `ACTION_CREATE_DOCUMENT`. Whether a given one
  (Drive, Downloads, OEM file managers) reports a size for a new document has
  not been checked on a device. One that doesn't will refuse every export with
  "This location can’t confirm the file is new, so nothing was saved…". The
  fallback to `"w"` follows any failure to open with `"wt"`, not only an
  unsupported mode. That is harmless because the destination is known to be
  empty, and if `"w"` also fails the export is cleaned up as a failed write.
- A write that fails part-way deletes the document
  (`DocumentsContract.deleteDocument`, `EXPORT_FAILED`). If the provider won't
  delete it, the user is told an incomplete file may remain
  (`EXPORT_INCOMPLETE`).
- Cancelling the picker does nothing.

**Share** (`ShareFiles`, `ShareIntent`):
- The attachment is decrypted into
  `cacheDir/attachments/share/<32 random hex>/<file name>` and checked against
  its record before the file gets its name. Only then does it get a URI.
- The URI comes from `androidx.core.content.FileProvider` (authority
  `com.trezor.app.attachments`), which is `exported="false"` and has
  `grantUriPermissions="true"`. Its only path is `<cache-path
  path="attachments/share/">`, so the encrypted attachments, the database and
  other cache files can't be reached through it. A JVM test parses the
  manifest and the paths file to keep it that way.
- The `ACTION_SEND` intent carries the stored MIME type, `EXTRA_STREAM` and
  `ClipData`, and only `FLAG_GRANT_READ_URI_PERMISSION`: no write grant and
  no persistable grant. It goes through `Intent.createChooser`.
- Share copies are kept at least 24 hours, because the receiving app may read
  them later. `purgeExpired` deletes copies older than that at startup
  (`collectGarbage`) and when the app returns to the foreground. A share still
  being prepared or launched is never deleted, whatever its timestamp
  **[verified: JVM]**. There is no background job, so if Trezor isn't opened
  again a copy stays in the private cache until the next launch or until
  Android clears the cache.
- If the share sheet can't be started (URI failure, no foreground activity,
  no app that can receive the file), no app can have the copy, so its folder
  is deleted at once (`ShareFiles.launch`). The original error is reported
  even if that cleanup fails, and other shares in progress are untouched.
  `ShareFiles.launch` is **[verified: JVM]**. How the module maps the Android
  failures (`NoActivityException` → `NO_ACTIVITY`, `ActivityNotFoundException`
  → `SHARE_UNAVAILABLE`) has no automated test: it is Android glue, and
  instrumentation tests are deferred.
- **File names** (Share and the name suggested to the Save a copy picker)
  come from `ExportFileNames.forExport`. The stored display name is not
  changed.
  1. The name is cleaned as on import: last segment, no control or bidi
     characters.
  2. Lone surrogates are dropped, and an extension is added if missing.
  3. The name is limited to **200 UTF-8 bytes**: the 255-byte file-name
     limit minus a 55-byte margin for provider suffixes such as " (1)".
  - The extension is kept. The base is cut on a code-point boundary. An
    extension over 16 bytes is replaced by the type's own (`.pdf`, `.jpg`, …).
  - **[verified: JVM]**, including a real share copy with a 352-byte CJK name
    (`6786ceb`).

Messages: missing, damaged, key unavailable, no app to save with, no app to
receive, destination not empty, and failed with or without a leftover file.
After a share there is nothing to report: the share sheet takes over.

### 14.10 Not verified yet

- The module and the card, document and viewer screens have not run on a
  device or emulator. That covers the pickers, content URIs, the Keystore
  key, view files, `PdfRenderer`, the save-to picker, FileProvider grants and
  the share sheet.
  - Installing on the test phone would upgrade its real data to schema v3,
    so it waits for approval.
  - Instrumentation tests are deferred: running them would uninstall the app
    from the phone.
- The v2 → v3 migration has run on real SQLCipher (§5), but on macOS, not
  Android.
- Known limitations are listed in §12.
