# Trezor — Technical Architecture (Phase 1 preparation)

Status: **proposal for review**. Nothing in this document is implemented yet.
Facts marked **[verified]** were checked against this repository or the named
package source on 2026-10-30; everything else is a recommendation.

---

## 0. Current state [verified]

| Area | State |
| --- | --- |
| Runtime | React Native 0.88.1, New Architecture on (`newArchEnabled=true`), Hermes, TypeScript |
| Android | `minSdk 24`, `targetSdk 36`, `compileSdk 37`, package `com.trezor.app` |
| Data | `src/data/ItemsProvider.tsx` holds `Item[]` in React state, seeded from `sampleData.ts`. Nothing is written to disk. |
| Data API | `items`, `sampleDataEnabled`, `setSampleDataEnabled`, `saveItem`, `deleteItem`, `togglePinned`, `setReminderCompleted` — all synchronous, `void`-returning |
| IDs | `createId()` = `Date.now()` base36 + `Math.random()` — **not** cryptographically random |
| Timestamps | ISO 8601 strings (`createdAt`, `updatedAt`); dates as `YYYY-MM-DD` strings |
| Settings | Theme preference in `ThemeProvider` `useState` — not persisted |
| Backup | `android:allowBackup="false"` — Android cloud/ADB backup disabled |
| Network | `INTERNET` declared only in the debug manifest; release APK requests no network permission |
| Signing | Release build type is signed with the **debug** keystore (template default) |
| Hardening | No `FLAG_SECURE`, R8/ProGuard disabled (`enableProguardInReleaseBuilds = false`) |

UI components consume data only through `useItems`, `useItemsOfType` and
`useItem`. This is the seam Phase 1 builds on.

---

## 1. Recommended storage technology

**Recommendation: `@op-engineering/op-sqlite` with SQLCipher enabled.**

### Options considered

| Option | Encryption | RN 0.88 / New Arch | Maintenance | Verdict |
| --- | --- | --- | --- | --- |
| **op-sqlite** | SQLCipher, build flag | JSI + codegen **[verified 19.0.3]** | Active (published 2026-10-29); small team | **Recommended** |
| expo-sqlite | SQLCipher via config | Yes | Active, Expo-backed | Viable; requires adding the Expo modules runtime to a bare app — a larger footprint for one feature |
| react-native-nitro-sqlite | Not first-class | Nitro (JSI) | Active | No built-in SQLCipher path |
| WatermelonDB | No official SQLCipher | Partial | Last release 2025-07 | Adds a sync/ORM model we don't need |
| react-native-sqlite-storage | Via forks only | Old bridge | Last release 2025-02 | Rejected |
| Realm | Built-in AES | — | Deprecated by vendor | Rejected |
| MMKV (key-value) | Built-in AES | Yes | Active | Not relational; key itself still needs Keystore. Not needed. |

### Why op-sqlite

- **SQLCipher is built in [verified].** `"op-sqlite": { "sqlcipher": true }` in
  `package.json` compiles the bundled SQLCipher **4.19.0** amalgamation
  (SQLite **3.53.4**) with `SQLITE_HAS_CODEC`, linked against OpenSSL.
- **Keys don't pass through SQL [verified].** `open({ encryptionKey })` calls
  `sqlite3_key_v2()` directly. The key never appears in a `PRAGMA` string or in
  trace output.
- **Fits the stack [verified].** It has New Architecture codegen, MIT licence,
  and Android + iOS support from one codebase.
- **Features we'll want later:** prepared statements, transactions, and
  optional FTS5 for full-text search, all from one SQLite engine.
- **Plain SQL, no ORM.** The schema is small (§5). A hand-written mapping layer
  stays easy to audit, which matters more here than ORM convenience. A query
  builder (Kysely, Drizzle) can be added later if queries become complex.

### Trade-offs accepted

- **Small maintainer base.** Bus-factor risk. Mitigation: pin the exact
  version, keep all SQL behind our repository layer (§6) so the driver can be
  swapped.
- **Third-party OpenSSL build [verified].** Android pulls
  `io.github.ronickg:openssl:3.3.2-1` from Maven Central. That's a supply-chain
  dependency on a community-built OpenSSL. Mitigation: Gradle dependency
  verification (checksums) for this artifact; track op-sqlite's OpenSSL
  updates.
- **Larger APK.** SQLCipher + OpenSSL add native code for each ABI. Measure in
  the spike (Step 1) and ship per-ABI splits or an AAB.
- **Not testable in Jest.** The library is native-only. SQL behaviour is tested
  on device; repository logic is tested in Jest against the in-memory
  implementation (§6, §10).

---

## 2. Security model

### What Android already provides

| Protection | Provided by | Covers | Does **not** cover |
| --- | --- | --- | --- |
| App sandbox | Linux UID per app | Other (non-root) apps reading our files | Root, OS exploits, forensic tools |
| File-based encryption (FBE) | Android 10+ (mandatory) | Device powered off or not yet unlocked since boot | Device unlocked since boot: files are readable by anything running as our UID or as root |
| Android Keystore / TEE / StrongBox | Hardware-backed keys | Key material cannot be extracted; can require user auth or an unlocked device | Data encrypted outside Keystore; misuse of keys while the app runs |
| `allowBackup=false` **[verified]** | Manifest | Data not copied into Google cloud backups or `adb backup` | Device-to-device transfer rules (see `dataExtractionRules`, §9) |

### Why app-level encryption is still needed

FBE protects a device that's switched off or hasn't been unlocked since boot.
Once the user unlocks it, every file in `/data/data/com.trezor.app` is readable
in plaintext by:
- anyone with root access;
- a forensic extraction tool;
- a malicious app exploiting an OS vulnerability.

For notes, document scans and card numbers that isn't enough. App-level
encryption means the data stays ciphertext at rest, and can only be decrypted
with a key the Keystore will release to this app alone.

### Threats in and out of scope

| In scope | Out of scope (stated honestly) |
| --- | --- |
| File extraction from a lost or stolen device, including rooted extraction after unlock | Malware with root running **while Trezor is unlocked** (it can read process memory) |
| Other apps on the device | A compromised OS or Keystore implementation |
| Backups leaking to other people or services | Shoulder-surfing (partly mitigated by app lock and `FLAG_SECURE`) |
| Casual access by someone holding an unlocked phone (app lock, later) | |

---

## 3. Key management strategy

### Key hierarchy

```
Android Keystore (hardware-backed, non-exportable)
└── KEK  "trezor.kek.v1"   AES-256-GCM, never leaves Keystore
    ├── wraps → DB key      32 random bytes  → SQLCipher raw key
    └── wraps → File key    32 random bytes  → attachment encryption (later)

User backup passphrase (later)
└── Argon2id / scrypt → Backup key  → encrypts backup archives only
```

### Rules

1. **Generate keys natively.** The DB key and file key come from `SecureRandom`
   inside native code. JavaScript's `Math.random` is never used for key
   material.
2. **Store keys only in wrapped form.** Each data key is encrypted with the
   KEK (AES-GCM, random 12-byte IV) and written to a small versioned file in
   `Context.noBackupFilesDir`:
   `{ v: 1, alg: "AES-256-GCM", iv, ciphertext }`. No hardcoded keys, and no
   plaintext keys in SharedPreferences or anywhere else.
3. **KEK properties:**
   - created with `KeyGenParameterSpec` and `PURPOSE_ENCRYPT | PURPOSE_DECRYPT`;
   - `setIsStrongBoxBacked(true)` when available, falling back to TEE;
   - `setRandomizedEncryptionRequired(true)`.
   - **Not** bound to user authentication in Phase 1 (see rule 6).
4. **Raw key, not passphrase.** The DB key goes to SQLCipher as a raw 256-bit
   key (`x'<64 hex>'`), which skips PBKDF2. The key is already full-entropy;
   PBKDF2's 256,000 iterations **[verified default]** would only slow down
   opening the database. *Spike item:* confirm op-sqlite passes the `x'…'` form
   through `sqlite3_key_v2` unchanged.
5. **Known exposure: the DB key passes through JavaScript.** op-sqlite only
   accepts the key from JS, so it briefly sits in Hermes memory as a string.
   This is an accepted limitation: anything that can read our process memory
   is already out of scope. Keep the reference short-lived; never log or
   serialise it.
6. **App lock and biometrics (later phase).** Start with a UI gate:
   `BiometricPrompt` / device credential before content is shown, KEK not
   auth-bound. Binding the KEK to user authentication is stronger, but if the
   user changes biometric enrolment the key is invalidated and **all data is
   permanently lost** unless a backup exists. Offer that only as an opt-in
   "strict lock" mode, after backup ships.
7. **Losing the key means losing data, by design.** If the KEK is gone or
   invalidated (factory reset, app data cleared, rare OEM Keystore bugs), the
   database is unrecoverable. The app must detect this (`KeyPermanentlyInvalidatedException`,
   unwrap failure) and show a clear recovery screen: restore from backup or
   start fresh. It must never silently create a new empty database over an
   unreadable one.

### Implementation choice for the key vault

**Recommendation: a small first-party Kotlin native module (`TrezorVault`)**
rather than `react-native-keychain`.

| | First-party `TrezorVault` | react-native-keychain 10.0.0 |
| --- | --- | --- |
| Code to own | ~200 lines Kotlin + TS spec | None |
| Maintenance | Ours | Last published 2025-03-23 **[verified]** — 19 months without a release |
| Fits the need | Exactly: generate random key → wrap → store → unwrap; later random bytes, file crypto | Built for username/password storage; we'd store a hex key as a "password" |
| Control | StrongBox, invalidation handling, storage location, key versioning | Partly configurable |
| iOS | Needs a Swift counterpart later (Keychain + Secure Enclave) | Already cross-platform |

The vault is small, security-critical and central to the product. Owning it
keeps it auditable and lets it grow to cover file encryption (§4). If you'd
rather not own native code, react-native-keychain is an acceptable fallback:
it does use Keystore-backed AES-GCM **[verified: `CipherStorageKeystoreAesGcm`]**.

---

## 4. File encryption strategy (design only — attachments are not in Phase 1)

- **Storage:** attachments live in `filesDir/attachments/<uuid>.bin`. The file
  name reveals nothing; the original name and MIME type are stored only inside
  the encrypted database.
- **Format:** chunked streaming AEAD, so large files never need to fit in
  memory and each chunk is authenticated. Two options:
  - **Google Tink `StreamingAead`** (`AES256_GCM_HKDF_4KB`) inside the native
    vault. **Preferred:** audited, and handles nonces, chunking and truncation
    detection.
  - A hand-rolled chunked AES-GCM format. Avoid unless Tink is blocked.
- **Keys:** the file key (§3) is the master. Tink derives a per-file subkey
  via HKDF, with the attachment UUID as associated data, so a file can't be
  swapped with another file's ciphertext.
- **Integrity:** record the SHA-256 of the plaintext in the `attachments` row.
  Verify it on decrypt and during backup verification.
- **Imports:** import directly from the content URI via a stream; never write
  plaintext to cache. Viewing needs a decrypted temp copy in
  `cacheDir/view/`, deleted when the viewer closes and on every app start.
- **Crash safety:** write to `<uuid>.bin.partial`, then fsync and rename, then
  insert the DB row in the same logical operation. A startup sweep removes
  orphan files and orphan rows.

---

## 5. Data model

### Principles

- **Stable IDs: UUIDv7** (time-ordered, 122 bits) from a native CSPRNG.
  Existing string IDs stay compatible (`TEXT PRIMARY KEY`).
- **Timestamps: `INTEGER` milliseconds since epoch, UTC.** The mapping layer
  converts to the ISO strings the UI uses today. Calendar dates (purchase
  date, warranty end) stay as `TEXT 'YYYY-MM-DD'`, because they're dates, not
  instants.
- **Common fields in one table, type-specific fields in one table per type.**
  This gives:
  - fast cross-type queries (Home, Search, counts) on a single table;
  - real columns and constraints for each type, instead of an opaque JSON blob.
- **Optimistic concurrency:** a `rev` integer is incremented on each update.
  It's cheap now and useful for backup merge and multi-window later.

### Schema v1

```sql
-- PRAGMA user_version = 1
CREATE TABLE items (
  id          TEXT PRIMARY KEY,                -- UUIDv7
  type        TEXT NOT NULL CHECK (type IN ('note','reminder','card','document')),
  title       TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX items_type_updated ON items(type, updated_at DESC);
CREATE INDEX items_pinned ON items(pinned) WHERE pinned = 1;

CREATE TABLE notes (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  body    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE reminders (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  due_at     INTEGER NOT NULL,
  repeat     TEXT NOT NULL CHECK (repeat IN ('none','daily','weekly','monthly','yearly')),
  notes      TEXT NOT NULL DEFAULT '',
  completed  INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))
);
CREATE INDEX reminders_open_due ON reminders(due_at) WHERE completed = 0;

CREATE TABLE cards (
  item_id      TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  card_number  TEXT NOT NULL,
  code_format  TEXT NOT NULL CHECK (code_format IN ('barcode','qr')),
  holder_name  TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE documents (
  item_id     TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('receipt','warranty','image','document')),
  merchant    TEXT NOT NULL DEFAULT '',
  date        TEXT,                 -- YYYY-MM-DD
  expires_on  TEXT,                 -- YYYY-MM-DD
  amount_minor INTEGER,             -- amount in minor units (cents), avoids float rounding
  currency    TEXT NOT NULL DEFAULT 'EUR',
  notes       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,          -- e.g. 'theme.preference'
  value  TEXT NOT NULL              -- JSON-encoded
);
```

Added in the attachments phase (schema v2, design only):

```sql
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,                    -- UUIDv7, also the file name
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  key_version INTEGER NOT NULL,                    -- which file key encrypted it
  state       TEXT NOT NULL CHECK (state IN ('ready','pending_delete')),
  created_at  INTEGER NOT NULL
);
```

### Changes to the TypeScript model

| Current | Proposed | Why |
| --- | --- | --- |
| `DocumentItem.amount: number \| null` | Keep in UI; store as `amount_minor` integer | Floats lose cents (`189.9`) |
| `DocumentItem.attachment: Attachment \| null` | `attachments: Attachment[]` via join (v2) | One document can have several pages or photos |
| `createId()` | `newId()` → UUIDv7 from native random | Collision resistance, sortable |
| `sampleDataEnabled` | Debug-only seeding (`__DEV__`) | Sample data must never mix with real user data in release |

Relationships: `items 1—1 {notes|reminders|cards|documents}` (exactly one,
chosen by `type`) and later `items 1—N attachments`. `PRAGMA foreign_keys = ON`
is set on every connection.

---

## 6. Repository abstraction

The UI must not know about SQL. The layers:

```
Screens / components
   │  useItems(), useItemsOfType(), useItem()        ← unchanged hooks
ItemsProvider (React state + optimistic updates)
   │  ItemRepository (interface)
   ├── InMemoryItemRepository   (tests, Storybook-style previews, dev)
   └── SqliteItemRepository     (production)
          │  Database (open, migrate, transaction)   ← only module importing op-sqlite
          │  TrezorVault (native key management)
```

```ts
// src/data/repository/ItemRepository.ts (proposed)
export interface ItemRepository {
  listAll(): Promise<Item[]>;
  get(id: string): Promise<Item | null>;
  save(item: Item): Promise<Item>;          // insert or update; returns stored version (rev bumped)
  delete(id: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setReminderCompleted(id: string, completed: boolean): Promise<void>;
}

export interface SettingsRepository {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}
```

### Keeping the `ItemsProvider` interface

- **Unchanged signatures:** `items`, `saveItem`, `deleteItem`, `togglePinned`
  and `setReminderCompleted` keep their current form. Each one:
  1. updates React state immediately (optimistic);
  2. calls the repository;
  3. rolls back and reports an error if the write fails.

  No screen changes are needed.
- **Added, not breaking:** `status: 'loading' | 'ready' | 'error'` and
  `error?: StorageError`, for the startup and recovery screens.
- **Reads:** the whole dataset loads into memory at startup. That's fine at
  personal-organizer scale: thousands of rows, a few MB of text. Revisit with
  paged queries if real usage grows past ~10k items.

---

## 7. Migration strategy

- **Versioning:** `PRAGMA user_version` holds the schema version. Migrations
  are an ordered TypeScript array `[{ version: 1, up(tx) }, …]`. They run
  forward only, and each one runs in its own transaction.
- **On open:**
  1. unwrap the key;
  2. open the database;
  3. run `PRAGMA cipher_integrity_check` and `PRAGMA quick_check`;
  4. if `user_version` < latest: copy the database file to
     `noBackupFilesDir/pre-migration-v<N>.db` (still encrypted), run the
     pending migrations, then run `PRAGMA foreign_key_check`;
  5. keep the copy until the next successful launch.
- **Downgrades:** if `user_version` > latest (the user installed an older
  build), refuse to open, with a clear message. Never write to a database from
  a newer schema.
- **No destructive migrations without a copy.** Column drops use SQLite's
  "create new table → copy → drop → rename" inside the same transaction.
- **Testing:** every migration gets a fixture test, run on device or emulator
  (see §10).

---

## 8. Backup compatibility (design only)

**Keystore keys can't leave the device, so backups can't depend on them.** A
backup is portable, self-contained and protected by a user passphrase:

```
trezor-backup-YYYYMMDD.trezor
├── header (plaintext, authenticated as AAD)
│     magic "TRZB", format_version, app_version, schema_version,
│     kdf { alg: "argon2id" | "scrypt", params, salt }, created_at
└── payload (streaming AEAD with the backup key)
      manifest.json      counts, sha256 for each attachment
      items.ndjson       one JSON object per entity (logical export, not a raw .db)
      attachments/<id>   re-encrypted with the backup key
```

- **Logical export, not a raw database file.** Restore then works across
  schema versions (it migrates during import), across platforms (a future iOS
  app), and even if SQLCipher defaults change.
- **Restore steps:** verify the header and manifest → decrypt to a staging
  database → migrate → run integrity checks → swap atomically with the live
  database. If anything fails, the current data stays untouched.
- **Key derivation:** Argon2id is preferred, scrypt is the fallback. Either
  needs native code; the choice is made in the backup phase.

---

## 9. Dependencies

### Phase 1 (storage foundation)

| Dependency | Purpose | Notes |
| --- | --- | --- |
| `@op-engineering/op-sqlite` (exact pin, e.g. `19.0.3`) | Encrypted SQLite | `"op-sqlite": { "sqlcipher": true }` in `package.json` |
| First-party `TrezorVault` (Kotlin, in `android/`) | Key generation, wrap/unwrap, random bytes | No npm dependency |

Nothing else for Phase 1. No ORM, no state library, no crypto JS library.

### Later phases (not now)

| Phase | Candidate |
| --- | --- |
| Attachments | `com.google.crypto.tink:tink-android` (inside `TrezorVault`) |
| App lock | `androidx.biometric:biometric` (inside a native module) |
| Backup | Argon2id/scrypt native implementation; Storage Access Framework for choosing the file |
| Date picker on iOS | Already covered by `@react-native-community/datetimepicker` |

Related configuration changes for Phase 1:
- add `android:dataExtractionRules` that excludes everything from
  device-to-device transfer (Android 12+);
- add Gradle dependency verification for the OpenSSL artifact.

---

## 10. Known risks and limitations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Key loss (factory reset, cleared app data, Keystore invalidation, OEM bugs) | All data unreadable | By design; recovery screen; encrypted backup in a later phase; never overwrite an unreadable DB |
| op-sqlite has a small maintainer base, frequent major versions | Upgrade churn, abandonment | Exact pin; driver isolated in `Database` module; SQLCipher DB files can be read by any SQLCipher build |
| Third-party OpenSSL artifact | Supply chain | Gradle checksum verification; monitor updates |
| DB key briefly in JS memory | Readable by in-process attacker | Out of scope by threat model; never log or persist |
| Native SQL not testable in Jest | Bugs found later | Repository contract tests in Jest (in-memory); on-device test screen or instrumentation tests for SQL and migrations |
| `minSdk 24` | `setUnlockedDeviceRequired` (API 28) and some StrongBox features unavailable on old devices | Decide: raise `minSdk` to 26 or 28 (≈ negligible market loss in 2026) |
| Release signed with debug key **[verified]** | Cannot publish; anyone can sign updates | Create upload key outside git before any distribution (`keystore.properties` is git-ignored) |
| No `FLAG_SECURE` **[verified]** | Content visible in Recents and screenshots | Add with app lock (a user setting) |
| APK size growth (SQLCipher + OpenSSL × 4 ABIs) | Larger download | Ship AAB / ABI splits; measure in Step 1 |
| Trademark ("Trezor" is a hardware-wallet brand) | Store rejection / legal | Check before publishing |

---

## 11. Proposed implementation sequence

Phase 1 = **encrypted persistence with the existing UI unchanged**. Each step is
a separate, reviewable commit.

### Step 1 — Spike: op-sqlite + SQLCipher on RN 0.88
- Add op-sqlite with `sqlcipher: true`; open a database with a random raw key
  on the emulator.
- **Acceptance criteria:**
  - debug and release builds succeed;
  - reading and writing work;
  - the database file pulled off the device (`adb exec-out run-as`) can't be
    opened by plain `sqlite3` and doesn't contain sample text in plaintext
    (`strings` check);
  - the `x'…'` raw key format is confirmed;
  - the APK size change is recorded.

### Step 2 — `TrezorVault` native module
- Kotlin module: `getOrCreateDatabaseKey()` and `randomBytes(n)`. Keystore KEK
  (StrongBox when available), wrapped key file in `noBackupFilesDir`, typed
  errors (`KEY_INVALIDATED`, `UNWRAP_FAILED`).
- **Acceptance criteria:**
  - the same key is returned across app restarts;
  - no key material appears in SharedPreferences, logs or `filesDir`;
  - clearing app data produces a new key;
  - a corrupted wrapped-key file gives `UNWRAP_FAILED` (doesn't crash or
    silently regenerate);
  - unit and instrumentation tests pass.

### Step 3 — Database module, schema v1, migration runner
- `Database.open()`: key → open → integrity checks → migrations (with a
  pre-migration copy) → `foreign_keys = ON`.
- **Acceptance criteria:**
  - a fresh install creates schema v1 (`user_version = 1`);
  - re-opening runs no migrations;
  - a newer `user_version` is refused;
  - integrity check failures surface as a typed error;
  - the migration test passes on the emulator.

### Step 4 — Repositories and mapping
- `ItemRepository` + `SettingsRepository` interfaces, plus `SqliteItemRepository`
  and `InMemoryItemRepository`.
- Row ↔ `Item` mappers: timestamps in ms, `amount_minor`, UUIDv7 `newId()`
  from `TrezorVault.randomBytes`.
- **Acceptance criteria:**
  - one shared contract test suite passes against the in-memory
    implementation in Jest;
  - the same scenarios pass on device against SQLite;
  - writes covering two tables (`items` + detail) are atomic.

### Step 5 — Wire `ItemsProvider` to the repository
- Load on start; optimistic updates with rollback; `status`/`error` added.
  Sample-data seeding only in `__DEV__`.
- **Acceptance criteria:**
  - create, edit, delete, pin and complete all survive an app restart;
  - no screen component changed apart from consuming `status`;
  - a release build starts empty (no sample data);
  - TypeScript, ESLint and Jest pass.

### Step 6 — Persist settings
- Theme preference stored in `settings`; read before the first render (show
  the splash background until it's ready).
- **Acceptance criteria:** the theme survives a restart, with no flash of the
  wrong theme.

### Step 7 — Startup and failure states
- Minimal screens built from existing components:
  - "Opening…";
  - "Trezor can't open your data" — with *Try again*, and *Start fresh (erase)*
    behind an explicit confirmation.
- **Acceptance criteria:**
  - a simulated key-unwrap failure shows the error screen;
  - existing data is never erased without a confirmation dialog.

### Step 8 — Hardening and documentation
- `dataExtractionRules`; Gradle checksum verification for OpenSSL; decide on
  `minSdk`; update `DESIGN.md` §9 (data no longer session-only) and README.
- **Acceptance criteria:**
  - a release APK built and installed;
  - data persists across restart and app update (install over the existing
    build);
  - the release APK still requests no network permission;
  - the docs are updated.

### Out of Phase 1 scope
App lock, biometrics, attachments and file encryption, backup and restore,
notifications, barcode rendering or scanning, iOS native counterparts, cloud
or backend.

---

## 12. Decisions needed before Step 1

1. Approve **op-sqlite + SQLCipher** as the storage engine.
2. Approve a **first-party `TrezorVault`** native module, or prefer
   `react-native-keychain`.
3. `minSdk`: keep 24, or raise to 26/28.
4. In release builds, should the Settings "Preview → Show sample data" switch
   be removed (recommended) or kept as a demo mode?
