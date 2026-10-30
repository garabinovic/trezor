# Trezor — Technical Architecture

Status: **Phase 2 implemented** (core organizer on encrypted local storage),
on top of Phase 1 and the Phase 1.1 corrections. This document describes what is built, why, and how it differs from
the Phase 1 proposal (git history: `docs: add Phase 1 technical architecture
proposal`). Phase 1.1 fixed the findings of the Phase 1 security audit; see
§10.1.

Claims marked **[verified]** were checked by an automated test or on the
Android emulator (API 37, arm64) on 2026-10-30. Everything else is design
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

No new JS runtime dependencies besides op-sqlite. The vault uses only
platform APIs (`AndroidKeyStore`, `javax.crypto`, `SecureRandom`, `org.json`).

---

## 12. Known issues and risks

| Risk | Status / mitigation |
| --- | --- |
| **Key loss = data loss.** Uninstall, "Clear storage" or Keystore loss make data unrecoverable | By design until encrypted backup exists. The error screen warns against uninstalling |
| Database key passes through JS (§4.4) | No longer retained by op-sqlite after `open()`; still present until GC in immutable JS/Java/C++ strings that can't be zeroed; never logged |
| No automatic restore from snapshots; snapshots and crashed-attempt temp files are never cleaned up (audit L7) | Manual-recovery artifacts only. Retention, cleanup and restore belong to the backup phase |
| Search reads all items per query (debounced), then matches in JS | Fine at personal-organizer scale; a normalized search column or FTS would need a schema change if data grows large |
| Reminders keep the Phase 0 "Repeat" field as a stored label only | No scheduling or notifications until Phase 3 |
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
