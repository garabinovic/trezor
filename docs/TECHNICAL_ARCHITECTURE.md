# Trezor — Technical Architecture

Status: **Phase 3 implemented** (reminders and local notifications, §13), on
top of Phase 2 (core organizer), Phase 1 and the Phase 1.1 corrections. This document describes what is built, why, and how it differs from
the Phase 1 proposal (git history: `docs: add Phase 1 technical architecture
proposal`). Phase 1.1 fixed the findings of the Phase 1 security audit; see
§10.1.

Claims marked **[verified]** were checked by an automated test or on the
Android emulator (API 37, arm64) on 2026-10-30 (Phase 1–2) or 2026-11-02
(Phase 3). Nothing has been verified on a physical device yet. Everything else is design
intent or a recommendation.

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
| `android/app/src/main/java/com/trezor/app/vault/` | `KeyVault` (Keystore + envelopes), `TrezorVaultModule` (JS bridge), typed `VaultException` |
| `src/native/NativeTrezorVault.ts` | TurboModule spec (app-level codegen, `codegenConfig` in `package.json`) |
| `src/storage/vault.ts` | TS wrapper; maps native rejections to `StorageError` |
| `android/app/src/main/java/com/trezor/app/storage/` | `DatabaseFiles`: definite file state, no-replace rename, temp-only delete (database directory only) |
| `src/native/NativeTrezorDatabaseFiles.ts`, `src/storage/databaseFiles.ts` | Spec and TS wrapper for the above |
| `src/storage/database.ts` | Startup matrix, verification, snapshot, migrations |
| `src/storage/sqlcipher.ts` | Key-format check, keyed `open()` (drops the key from op-sqlite's retained options), encryption/integrity verification |
| `src/storage/snapshot.ts` | Atomic, verified pre-migration snapshots |
| `src/storage/serialDatabase.ts` | Serializes every statement and transaction on the shared connection |
| `src/storage/migrations.ts` | Schema v1, `user_version` migration runner, foreign-key procedure |
| `src/storage/SqliteItemRepository.ts` | Row ↔ `Item` mapping, atomic writes |
| `src/storage/SettingsRepository.ts` | Typed settings (`theme.preference`) |
| `src/storage/StorageProvider.tsx`, `openStorage.ts` | Startup state for the app shell |
| `src/storage/ids.ts` | UUIDv7 |
| `src/data/search.ts` | Searchable fields per type; Unicode-aware matching (Phase 2) |
| `src/data/organizer.ts` | Category filters, sort orders, Home overview (Phase 2; moved out of screens) |
| `test-utils/appHarness.tsx` | Drives the whole app in Jest (only visible screens are queried) |
| `src/storage/selfTest.ts` | Debug-only on-device SQLCipher checks (dev menu) |
| `src/reminders/` | Recurrence rules, reminder schedule helpers, reconciliation, `RemindersProvider` (Phase 3, §13) |
| `android/app/src/main/java/com/trezor/app/reminders/` | Recurrence (Kotlin mirror), encrypted schedule record, alarms, notifications, receivers, `TrezorReminders` TurboModule (Phase 3) |
| `test-fixtures/recurrence.txt` | Hand-computed recurrence cases shared by the Jest and JVM tests |

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
└── wraps → database key (32 random bytes, SecureRandom)
              → SQLCipher raw key  x'<64 hex>'
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
| Uninstall / reinstall | Android deletes the app's Keystore entries and files | **Lost by design** (no backup yet) |
| "Clear storage" in system settings | Files and Keystore entries removed → treated as a first launch | **Lost by design** |
| Database file state can't be determined (I/O or permission error) | `DATABASE_STATE_UNKNOWN`; no key is created **[verified: Jest]** | Kept |
| Vault returns a malformed key | `INVALID_KEY_FORMAT` before anything is opened **[verified: Jest]** | Kept |
| Envelope missing, DB present | `KEY_MISSING_FOR_DATABASE` error screen; no new key, DB untouched **[verified: envelope moved aside]**; *Try again* recovers once the envelope is back **[verified]** | Kept on disk, unreadable |
| Master key missing, envelope present | `MASTER_KEY_MISSING` **[verified: test]** | Kept on disk, unreadable |
| Envelope tampered / corrupt | `UNWRAP_FAILED` **[verified: test]** | Kept on disk, unreadable |
| Key permanently invalidated | `KEY_INVALIDATED` (not expected while the key isn't auth-bound) | Kept on disk, unreadable |
| Android backup / device transfer | Excluded by manifest rules. Even if copied, the DB is useless without the device-bound master key | Not transferred |
| New phone | Nothing migrates. Moving data will need the encrypted export of the backup phase (§8) | — |

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

The full DDL is in `src/storage/migrations.ts`. Relationships:
`items 1—1 {notes|reminders|cards|documents}`, chosen by `type`. A save that
tries to change an item's type is rejected **[verified]**.

**Not stored (deliberately):**
- `DocumentItem.attachment` is always `null` from storage. Attachments arrive
  with their own table in a later phase.
- No `rev`/version column per row. It was proposed but has no consumer yet;
  add it with sync or merge-on-restore.

### Settings

| Key | Persistent | Notes |
| --- | --- | --- |
| `theme.preference` | Yes (settings table) **[verified across restart]** | `'system' \| 'light' \| 'dark'`; read before first render |
| `notifications.showDetails` | Yes **[verified across restart]** | Boolean, default `false` (generic notification text) |
| `notifications.permissionRequested` | Yes | Boolean; the Android 13+ permission is asked at most once |
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
   `renameNoReplace` refuses to replace an existing file.
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
  - While opening, a plain view in the theme background is shown.
  - On failure, `StorageErrorScreen` shows one of five messages chosen by
    error code, the code itself, a *Try again* button, and advice not to
    uninstall.
- **Writes:** `ItemsProvider` applies a change to state immediately, then
  queues the repository write (writes run strictly in order).
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
    cards (name, number, holder, notes); documents (title, issuer, notes, type
    label, file name).
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

## 8. Compatibility with future encrypted backup and restore

The design keeps backup independent of this device's Keystore:

- **Format:** backups will be a **logical export** (NDJSON per entity, tagged
  with `schema_version`), encrypted with a key derived from a user passphrase
  (Argon2id or scrypt). They will not be a copy of `trezor.db`, which is useless
  off-device.
- **Restore:** import into a staging database, run the same migrations, then
  `quick_check`, `cipher_integrity_check` and `foreign_key_check`, then swap.
- **Why the current model fits:**
  - UUIDv7 IDs, so imports don't collide;
  - integer timestamps;
  - a typed, versioned schema;
  - every write path goes through repositories.
- **Key rotation:** the envelope's `version` and `keyId`, and the master key
  alias `.v1`, leave room to rotate keys and add a separate file key for
  attachments.

---

## 9. Testing

| Kind | What | Result |
| --- | --- | --- |
| Jest (automated) | 136 tests in 11 suites. Phase 1/1.1 suites (66) unchanged. Phase 2 adds: repository CRUD of every field for each type, type separation, pinning, ordering, search coverage and order, deletes, database errors and invalid input, on both repository implementations (23 more in `itemRepository.test.ts`, now 40); search matching incl. non-ASCII case (7); organizer filters, sorts, Home overview, document summaries (13); editor validation and normalization (13); **app-level flows** (14) driving the real screens and navigation on the real SQLite repositories via `serializeDatabase` (Home with stored data, all tabs and filter chips, create/edit/delete/pin/complete, validation, failed write, search opens the right item, theme and data persist across a remount) | **136/136 pass** |
| Jest after Phase 3 (automated) | 228 tests in 14 suites; Phase 1–2 tests kept (fixtures updated to the v2 reminder shape; organizer sort tests updated to next-occurrence order, an intended change) plus the Phase 3 tests in §13.9 | **228/228 pass** |
| JVM unit (automated) | `RecurrenceTest` (4) | **4/4 pass** |
| Android instrumentation after Phase 3 (automated, emulator API 37) | `KeyVaultTest` 12, `DatabaseFilesTest` 9, `ReminderSchedulerTest` 15 | **36/36 pass** |
| Android instrumentation (automated, emulator) | `KeyVaultTest` (12) against the real Keystore; `DatabaseFilesTest` (9): present/absent, unreadable location is an error not "absent", no-replace rename, temp-only delete, path rejection | **21/21 pass** |
| On-device self-test (debug, dev menu → "Run storage self-test") | 21 checks on real SQLCipher: active cipher; correct/wrong/missing key; native file guards; startup; foreign keys ON; failed migration leaves v1 with a verified snapshot; retry reuses it; migration keeps data; snapshot unreadable without key; invalid snapshot kept and a new one used; table rebuild keeps rows; violation rolls back; newer schema refused | **21/21 pass** |
| Manual upgrade test (emulator) | Data created with the Phase 1 release build (`06b022c`), then the Phase 1.1 debug build installed over it: data, theme and envelope intact; no migration, no snapshot, `trezor.db` unchanged on open; new writes and theme change persisted across restart | As expected |
| Manual (Phase 1, unchanged since) | First launch; create note/card/reminder; edit; delete; pin; complete; search; Done filter; Home counts, Pinned and Recently updated; theme; persistence across force-stop; missing-key error + retry; release installed over debug | All as expected |
| Manual on-disk inspection (Phase 1) | Raw `trezor.db`: no plaintext of entered data or schema; random header; host `sqlite3` refuses; envelope holds only the wrapped key | As expected |

Commands: `npx tsc --noEmit`, `npm run lint`, `npm test`,
`cd android && ./gradlew :app:connectedDebugAndroidTest` (needs a running
emulator or device; **it uninstalls the app afterwards**).

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
| `junit:junit` | 4.13.2 | JVM unit tests only (Phase 3) | Runs `RecurrenceTest` on the JVM; not packaged in the app |

No new JS runtime dependencies besides op-sqlite. Phase 3 adds no runtime
dependency (reminders use only Android framework APIs). The vault uses only
platform APIs (`AndroidKeyStore`, `javax.crypto`, `SecureRandom`, `org.json`).

---

## 12. Known issues and risks

| Risk | Status / mitigation |
| --- | --- |
| **Key loss = data loss.** Uninstall, "Clear storage" or Keystore loss make data unrecoverable | By design until encrypted backup exists. The error screen warns against uninstalling |
| Database key passes through JS (§4.4) | No longer retained by op-sqlite after `open()`; still present until GC in immutable JS/Java/C++ strings that can't be zeroed; never logged |
| No automatic restore from snapshots; snapshots and crashed-attempt temp files are never cleaned up (audit L7) | Manual-recovery artifacts only. Retention, cleanup and restore belong to the backup phase |
| Search reads all items per query (debounced), then matches in JS | Fine at personal-organizer scale; a normalized search column or FTS would need a schema change if data grows large |
| Reminder timing is approximate (no exact-alarm permission, by decision) | Up to 10 min late while awake, up to ~1 h in Doze; documented in the editor (§13.6) |
| OEM battery managers ("app killers") and force-stop | Force-stop removes all alarms until the app is opened again; some OEMs behave like force-stop. Not fixable without exact/foreground mechanisms (§13.8) |
| Phase 3 not tested on a physical device or on API 24–33 | Emulator API 37 only; see the manual checklist in the Phase 3 report |
| Reboot re-arming not verified | Emulator could not complete it (§13.8). If Android drops `BOOT_COMPLETED` (as the overloaded emulator did), alarms stay unarmed until the app is next opened |
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

Not requested: `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`,
`FOREGROUND_SERVICE`, `WAKE_LOCK`, `INTERNET` (release). `ReminderRestoreReceiver`
is exported (system broadcasts) and acts only on `BOOT_COMPLETED`,
`MY_PACKAGE_REPLACED`, `TIME_SET`, `TIMEZONE_CHANGED`; re-arming is idempotent.
`ReminderAlarmReceiver` is not exported. The notification tap intent is
explicit (`MainActivity`, immutable).

### 13.6 Delivery accuracy

No exact-alarm permission (decision 2). Each occurrence is armed with two
inexact alarms; whichever fires first delivers it and the other is ignored
(it carries the same occurrence, which is no longer the armed one):

| Alarm | Behaviour |
| --- | --- |
| `setWindow(RTC_WAKEUP, t, 10 min)` | Within 10 minutes while the device is awake (Android's minimum window); deferred in Doze |
| `setAndAllowWhileIdle(RTC_WAKEUP, t)` | Fires in Doze too, but Android allows delay of up to 75 % of the lead time, capped at 1 h |

So a reminder arrives at its time or **up to ~10 minutes late** when the phone
is in use, and **up to about an hour late** when it is idle. The editor says
so. Observed on the emulator: 0:22, 2:26 and 1:02 min after the set time.

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
| Reboot | `BOOT_COMPLETED` → `rearmAll` from the native record. **NOT VERIFIED — emulator instability**: on the first emulator reboot Android delivered `BOOT_COMPLETED` after 9 min and then killed the process with "start timeout" before it attached (system overload, load average ~57); the second reboot never completed (system processes crashing). `rearmAll` itself is covered by instrumentation. Must be verified on a physical device |
| App update | `MY_PACKAGE_REPLACED` → `rearmAll` **[verified: emulator upgrade]** |
| Clock / zone change | `TIME_SET` / `TIMEZONE_CHANGED` → `rearmAll`; calendar modes follow the new zone **[verified: emulator, Belgrade ↔ New York]** |
| App launch, return to foreground | Full reconciliation from the database |
| Process killed by the system | Alarms survive; receivers start the process without UI |
| Force-stop (Settings → Force stop) | Android removes the app's alarms and blocks its receivers until the user opens it; opening the app re-arms everything. Not avoidable |
| OEM battery restrictions | Some vendors defer or drop alarms of restricted apps. Users may need to exempt Trezor; not testable on the emulator |
| Notifications disabled / denied | Alarms still fire, Android drops the notification; Settings shows "Notifications are off" |
| Keystore or record unreadable in a receiver | Nothing shown; the next reconciliation rebuilds the record |
| Sample data (debug) | Never scheduled (only the real repository is reconciled) |

### 13.9 Phase 3 tests

| Kind | What | Result |
| --- | --- | --- |
| Jest | Recurrence fixtures in an `Intl` zone (Belgrade, New York, London), schedule helpers, entry building, privacy of entries, reconciliation (idempotence, fired ONCE completion, deleted reminders), queue, permission policy, migration v2 (preservation, constraints, rollback), repository fields × 6 modes, settings, editor validation, Home sorting, 17 app-level reminder flows | See §9 |
| JVM unit (`./gradlew :app:testDebugUnitTest`) | `RecurrenceTest`: shared fixtures, day numbers, invalid intervals, parsing | 4/4 |
| Instrumentation | `ReminderSchedulerTest` (15) on real AlarmManager, NotificationManager, Keystore | See §9 |
| Emulator (manual) | Upgrade Phase 2 release → Phase 3 with data; delivery generic and detailed; taps from background and killed process; zone change | As expected (see the Phase 3 report) |
| Emulator (manual) | Reboot re-arming | **NOT VERIFIED — emulator instability** |
| Physical device | — | **Not performed** |
