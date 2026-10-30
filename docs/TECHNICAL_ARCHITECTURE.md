# Trezor — Technical Architecture

Status: **Phase 1 implemented** (encrypted local storage). This document
describes what is built, why, and how it differs from the Phase 1 proposal
(git history: `docs: add Phase 1 technical architecture proposal`).

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
   │  openTrezorDatabase()  ─────┘  op-sqlite 19.0.3 + SQLCipher 4.19.0
   │      │
   │      └── vault (TS) ── TrezorVault TurboModule (Kotlin) ── Android Keystore
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
| `src/storage/database.ts` | Startup matrix, verification, pre-migration snapshot |
| `src/storage/migrations.ts` | Schema v1, `user_version` migration runner |
| `src/storage/SqliteItemRepository.ts` | Row ↔ `Item` mapping, atomic writes |
| `src/storage/SettingsRepository.ts` | Typed settings (`theme.preference`) |
| `src/storage/StorageProvider.tsx`, `openStorage.ts` | Startup state for the app shell |
| `src/storage/ids.ts` | UUIDv7 |
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
- **Wiping:** plaintext key bytes are zeroed in Kotlin after use. The hex
  string passed to JS can't be zeroed (see §4.4).

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

**Exposure:** the 64-character hex key exists as a Hermes string from
`vault.getKey()` until `open()` returns, and possibly longer until garbage
collection. JS strings are immutable and can't be zeroed.

**Mitigations in place:**
- The key is fetched only inside `openTrezorDatabase()` and never stored in
  state, context or module-level variables.
- It is never logged: the only storage logs are error *codes*, and the vault
  doesn't log.
- Error messages never include it.
- The database key is the only key that crosses into JS.

**Residual risk:** an attacker able to read the app's process memory while it
runs could find the key. That attacker is already out of scope (they could read
decrypted data directly).

### 4.5 Lifecycle scenarios

| Scenario | What happens | Data |
| --- | --- | --- |
| First launch | No envelope, no DB → master key + database key created, DB created at schema v1 **[verified]** | — |
| Normal launch | Envelope unwrapped → DB opened and verified **[verified]** | Kept |
| App update (install over) | Keystore entry, envelope and DB all kept **[verified: debug → release install]** | Kept |
| Uninstall / reinstall | Android deletes the app's Keystore entries and files | **Lost by design** (no backup yet) |
| "Clear storage" in system settings | Files and Keystore entries removed → treated as a first launch | **Lost by design** |
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

## 6. Migrations

- `PRAGMA user_version` holds the schema version. `migrations` is an
  append-only array of `{ version, description, up(tx) }`.
- **On every open** (`openTrezorDatabase`), in order:
  1. Unwrap the key (never create one for an existing DB).
  2. Open with the raw key.
  3. Probe `SELECT count(*) FROM sqlite_master`. Code 26 →
     `DATABASE_UNREADABLE`, code 11 → `DATABASE_CORRUPT`. A wrong key only
     shows up at the first query, not at `open()` **[verified in spike]**.
  4. Check `PRAGMA cipher_version` is non-empty. This refuses to run if
     SQLCipher isn't actually active.
  5. `PRAGMA quick_check` must be `ok`.
  6. `PRAGMA foreign_keys = ON`.
  7. If `0 < user_version < latest`:
     - `PRAGMA cipher_integrity_check` (HMAC of every page);
     - an **encrypted snapshot** through `ATTACH … KEY` +
       `sqlcipher_export()`, saved as
       `trezor.pre-migration-v<N>.db` in the same private directory. The
       version is copied explicitly, because `sqlcipher_export` does not copy
       `user_version`.
  8. Run each pending migration and its `user_version` bump **in one
     transaction**.
  9. Then `PRAGMA foreign_key_check`.
- A newer `user_version` than the app knows → `NEWER_SCHEMA`; nothing is written.
- A failed migration → `MIGRATION_FAILED`; the DB stays at the last good
  version and the snapshot is kept.

**Verification:**
- **Jest (node:sqlite):** fresh migrate, idempotent re-run, newer schema
  refused, failing migration rolls back, additive migration keeps rows, `STRICT`
  and `CHECK` enforcement, cascade **[verified]**.
- **On-device self-test (SQLCipher):** a failed migration leaves v1; a v2
  migration keeps data; the snapshot is encrypted, at v1, and unreadable
  without the key; a newer schema is refused **[verified]**.

Snapshots are not deleted automatically yet. They're encrypted and excluded
from backup. Cleanup belongs to the backup phase.

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
  - If a write fails, state is reloaded from storage and a dialog explains
    the change wasn't saved.
  - Covered by Jest **[verified]**.
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
| Jest (automated) | 36 tests: UUIDv7 (5), migrations (9), repository contract on in-memory **and** SQLite + storage details + settings (18), ItemsProvider persistence/rollback/sample isolation/ids (4), App smoke test (1) | **36/36 pass** |
| Android instrumentation (automated, emulator) | `KeyVaultTest`, 12 tests against the real Keystore | **12/12 pass** |
| On-device self-test (debug, dev menu → "Run storage self-test") | 13 SQLCipher checks: active cipher, correct/wrong/missing key, startup path, failed and successful migration, encrypted snapshot, newer schema | **13/13 pass** |
| Manual (emulator) | First launch; create note/card/reminder; edit; delete; pin; complete; search; Done filter; Home counts, Pinned and Recently updated; theme; persistence across force-stop; missing-key error + retry; release installed over debug | All as expected |
| Manual on-disk inspection | Raw `trezor.db`: no plaintext of entered data or schema; random header; host `sqlite3` refuses; envelope holds only the wrapped key | As expected |

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
| Database key passes through JS (§4.4) | Documented; minimal lifetime; never logged |
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
