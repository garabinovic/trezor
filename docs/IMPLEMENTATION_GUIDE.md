# Trezor — Implementation Guide

Context for a developer or coding agent who has never seen this project's
history. It explains what exists, how the parts fit together and which rules
must hold when you change it. For full detail it links to
[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) (TA) and
[DESIGN.md](DESIGN.md); where this guide and the code disagree, **the code
wins**. Inspect it before acting.

State described: `main` at `6786ceb`, 2026-11-03. That is Phase 4 plus three
follow-up commits: review fixes `06004a0`, KeyVault hardening `04c4605` and
UTF-8-safe export names `6786ceb`. Final Phase 4 acceptance is still pending. Statements were checked against the source. Anything that could
not be checked is marked *(unverified)*.

---

## A. Project overview

**Trezor** is a private, offline-first personal organizer for Android with
four item types: **notes, reminders, loyalty cards and documents**. Cards and
documents can hold encrypted photos and PDFs.

**Core principles**, enforced by the code and the build:
- All data stays on the device. There are no accounts, cloud, sync,
  analytics, ads, crash reporting or push services.
- **Release builds have no network permission.** `INTERNET` is declared only
  in `android/app/src/debug/AndroidManifest.xml`, so Metro can serve the JS
  bundle. Release permissions are `POST_NOTIFICATIONS`,
  `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, plus androidx's own
  signature-level `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (checked in the
  merged release manifest).
- **Encrypted at rest:**
  - items and settings live in SQLCipher;
  - attachments are encrypted files;
  - keys are wrapped by a non-exportable Android Keystore key.
- **Never destroy data as recovery.** Errors show a screen with *Try again*.
  Nothing is reset, recreated or deleted automatically.
- No new runtime dependency without a reason. JS runtime dependencies (see
  `package.json`): React Navigation 7, `react-native-screens`,
  `react-native-safe-area-context`, `react-native-svg` + `lucide-react-native`,
  `@react-native-community/datetimepicker` and `@op-engineering/op-sqlite`
  19.0.3 (exact pin, SQLCipher on).

**Stack:**
- React Native **0.88.1**: bare CLI, TypeScript, New Architecture
  (TurboModules via app-level codegen, `codegenConfig` in `package.json`,
  generated package `com.trezor.app.vault`).
- Kotlin native modules.
- Android only in practice: `minSdk 24`. An `ios/` folder exists from the
  template, but nothing has been built or tested for iOS.

**Status:** Phases 0–4 are implemented (section I). Phase 4 is verified by
JVM and Jest tests and a real-SQLCipher migration check. **None of the
Phase 4 features has run on a device or emulator yet** (section J).

---

## B. Architecture and project structure

```
React screens (src/screens)            ← Phase 0 design system (src/theme, src/components)
   │ hooks: useItems/useItem/useItemsOfType, useReminders, useStorage, useTheme
ItemsProvider (src/data/ItemsProvider.tsx)   optimistic state + ordered write queue
RemindersProvider (src/reminders)            reconciles DB → native alarms
StorageProvider (src/storage)                startup: opening → ready | error
   │ openStorage(): openTrezorDatabase() + repositories + startup attachment cleanup
SqliteItemRepository / SqliteSettingsRepository  (SQL only here and in migrations)
   │ SqlDatabase interface (src/storage/sql.ts), serializeDatabase() FIFO
op-sqlite + SQLCipher 4.19.0
                                    ── TurboModules (Kotlin, android/app/src/main/java/com/trezor/app) ──
src/storage/vault.ts            → TrezorVault        (vault/)        Keystore + key envelopes
src/storage/databaseFiles.ts    → TrezorDatabaseFiles (storage/)     definite file state, no-replace rename
src/reminders/platform.ts       → TrezorReminders    (reminders/)    AlarmManager, notifications
src/attachments/platform.ts     → TrezorAttachments  (attachments/)  encrypted files, pickers, viewer, export, share
```

**Who does what:**
- **TypeScript:** UI, domain types and validation (`src/data`), all SQL
  (`src/storage`), reminder recurrence and reconciliation (`src/reminders`),
  and the attachment metadata lifecycle (`src/attachments`,
  `src/screens/editor/attachmentSession.ts`).
- **Kotlin:**
  - Keystore and key envelopes;
  - all file bytes of attachments: encryption, decryption, pickers, PDF
    rendering, SAF export, FileProvider share;
  - alarms, notifications and broadcast receivers;
  - file operations in the database directory.

**Directories:**

| Path | Responsibility |
| --- | --- |
| `src/theme/` | `tokens.ts` (colours, type, spacing, radius), `ThemeProvider`, `useStyles` |
| `src/components/` | Reusable UI: `Text`, `Button`, `IconButton`, `ListItem`, `Section`, `TextField`, `DateField`, `ChipGroup`, `Dialog`, `Sheet`, `EmptyState`, `Screen`, `ScreenHeader` (`BarHeader`), `Fab`, `ValueRow`, `Divider`, `SearchField`, `Icon` |
| `src/data/` | `types.ts` (Item model), `attachments.ts` (limits, validation), `ItemsProvider.tsx`, `format.ts`, `search.ts`, `organizer.ts` (filters, sorts, Home), `categories.ts`, `sampleData.ts` (debug only) |
| `src/storage/` | DB open/verify (`database.ts`, `sqlcipher.ts`), `migrations.ts`, `snapshot.ts`, repositories, `serialDatabase.ts`, `openStorage.ts`, `StorageProvider.tsx`, `errors.ts`, `ids.ts`, `vault.ts`, `selfTest.ts` (debug) |
| `src/reminders/` | `recurrence.ts`, `reminderSchedule.ts`, `scheduler.ts` (reconcile), `platform.ts`, `RemindersProvider.tsx` |
| `src/attachments/` | `platform.ts` (native wrapper and error codes), `AttachmentImage.tsx` (`useAttachmentView`, tiles), `ZoomableImage.tsx` + `zoom.ts`, `PdfPages.tsx` (`usePdfDocument`) |
| `src/native/` | TurboModule specs (`NativeTrezor*.ts`); codegen input |
| `src/navigation/` | `RootNavigator.tsx` (native stack), `TabNavigator.tsx`, typed routes in `types.ts` |
| `src/screens/` | Home, Notes, Reminders, Cards, Documents tabs; `ItemDetailScreen`, `ItemEditorScreen` (+ `editor/`), `AttachmentViewerScreen`, `SearchScreen`, `SettingsScreen`, `StorageErrorScreen`; `shared/` |
| `android/app/src/main/java/com/trezor/app/` | `vault/`, `storage/`, `reminders/`, `attachments/`, `MainApplication.kt` (registers the four packages), `MainActivity.kt` |
| `android/app/src/test/` | JVM unit tests (attachments, recurrence) |
| `android/app/src/androidTest/` | Instrumentation tests (`KeyVaultTest`, `DatabaseFilesTest`, `ReminderSchedulerTest`); **running them uninstalls the app** |
| `__tests__/`, `test-utils/`, `test-fixtures/` | Jest suites, the app harness and fakes, shared recurrence fixtures |

**Navigation:**
- Root native stack: `Tabs`, `ItemDetail {id}`, `ItemEditor {type, id?}`
  (slides up), `AttachmentViewer {itemId, attachmentId}`, `Search`,
  `Settings`.
- Bottom tabs: Home, Notes, Reminders, Cards, Documents.
- Search and Settings are header actions, not tabs.
- A tapped reminder notification opens `ItemDetail` (`RootNavigator`).

**Where code belongs:**
- Screens never run SQL or import storage directly. They use the providers'
  hooks.
- Validation shared by UI and storage lives in `src/data` (e.g.
  `attachmentProblem`). Editor-only rules live in `src/screens/editor/drafts.ts`.
- New SQL goes only into a repository or a new migration.
- New file or crypto work goes into Kotlin, never JS.

---

## C. Data model and persistence

**Database:**
- `trezor.db` in op-sqlite's default directory, opened with a raw 32-byte
  key (`x'<64 hex>'`, applied with `sqlite3_key_v2` before any statement).
- SQLCipher 4.19.0 with the OpenSSL provider.
- `PRAGMA foreign_keys = ON`.
- Every open verifies: probe query, `cipher_version`, `quick_check`
  (`verifyEncryptedDatabase` in `src/storage/sqlcipher.ts`).

**Schema v3** (`PRAGMA user_version = 3`). All tables are `STRICT`; DDL in
`src/storage/migrations.ts`:

| Table | Columns (main) | Notes |
| --- | --- | --- |
| `items` | `id` PK, `type` (note/reminder/card/document), `title`, `pinned`, `created_at`, `updated_at` | Shared fields; index on `(type, updated_at DESC)` |
| `notes` | `item_id` → items CASCADE, `body` | |
| `reminders` | `item_id`, `due_at`, `local_start` ('YYYY-MM-DDTHH:MM'), `repeat` (once/daily/weekly/monthly/yearly/interval), `interval_minutes` (only for interval), `notes`, `completed` | Rebuilt in v2; partial index on open reminders |
| `cards` | `item_id`, `card_number`, `code_format` (barcode/qr; kept, not shown), `holder_name`, `notes`, `issuer` (v3, default '') | |
| `documents` | `item_id`, `kind` (receipt/warranty/image/document), `merchant`, `date`, `expires_on` (TEXT dates), `amount_minor` (cents), `currency`, `notes` | |
| `attachments` (v3) | `id` PK (UUIDv7, also names the file), `item_id` → items CASCADE, `role` (card_front/card_back/document), `position`, `file_name`, `mime_type`, `size_bytes`, `sha256`, `format_version`, `created_at` | Unique `(item_id, role, position)`; CHECK: card roles are images at position 0. **No file paths are stored** |
| `settings` | `key` PK, `value` (JSON text) | Keys: `theme.preference`, `notifications.showDetails`, `notifications.permissionRequested`, `notifications.exactAlarmRequested` (`SettingValues` in `SettingsRepository.ts`) |

**TS model** (`src/data/types.ts`):
- Every item has `id, type, title, pinned, createdAt, updatedAt` (ISO strings
  in TS, integer ms in SQL).
- `LoyaltyCard` has `issuer, cardNumber, codeFormat, holderName, notes,
  frontImage, backImage`.
- `DocumentItem` has `kind, merchant, date, expiresOn, amount, currency,
  notes, attachments[]`.
- `Attachment` is `{id, fileName, mimeType, sizeBytes, sha256, formatVersion,
  createdAt}`.

**Repositories** (`src/storage/ItemRepository.ts`):
- The `ItemRepository` methods are `listAll`, `save` (upsert; returns the
  attachment ids it removed), `delete` (returns the deleted item's attachment
  ids), `search` and `listAttachmentIds`.
- `SqliteItemRepository` writes the item, its detail row and its
  `attachments` rows in **one transaction**.
- Changing an item's type is rejected.
- `InMemoryItemRepository` (sample data, tests) enforces the same rules.

**Conventions:**
- IDs are UUIDv7 (`src/storage/ids.ts`, randomness from the vault's
  `SecureRandom`). Kotlin's `AttachmentIds` uses the identical layout, and
  both sides test against a shared vector.
- Timestamps are UTC milliseconds; calendar dates are `TEXT`; money is in
  minor units.

**Serialization:**
- `serializeDatabase` puts every statement and transaction on the shared
  connection through one FIFO.
- Inside `transaction(fn)` use the `tx` you are given. Calling the outer
  database from inside deadlocks.

**Writes from the UI:**
- `ItemsProvider` applies changes to state at once and queues repository
  writes in order.
- On failure it reloads from storage and shows `WriteErrorDialog`.
- After a successful write it deletes the files of removed attachments. Only
  for the real repository, never for sample data.

**Migrations and snapshots** (TA §6):
- `migrations` is append-only. Never edit a shipped migration; add a new one.
- `openTrezorDatabase` runs before each migration batch:
  1. a verified, encrypted **snapshot** made with `sqlcipher_export` into a
     temporary file, reopened and compared row by row, then renamed with
     no-replace to `trezor.pre-migration-v<N>.db`;
  2. `runMigrations`: foreign keys OFF outside a transaction, then one
     transaction per migration with `foreign_key_check` before commit, then
     foreign keys back ON, verified.
- A newer schema than the app knows gives `NEWER_SCHEMA`; nothing is written.
- Snapshots are never deleted automatically, and there is no automatic
  restore.

**Errors:**
- Everything maps to `StorageError` codes (`src/storage/errors.ts`), shown
  by `StorageErrorScreen`.
- Logs contain codes only, never content or keys.

---

## D. Security and encryption

**Key hierarchy** (TA §4):
- Keystore master key `trezor.master.v1`: AES-256-GCM, non-exportable,
  StrongBox when available. It wraps 32-byte data keys stored as JSON
  envelopes in `noBackupFilesDir/keys/<keyId>.key.json`. The AAD binds
  format, version, key id and master alias.
- Data keys:
  - **`database`** is created by JS (`openTrezorDatabase`) on a genuine
    first launch only;
  - **`reminders`** is used natively (`ScheduleStore`) for the encrypted
    alarm record;
  - **`attachments`** is used natively (`AttachmentKeys`).
- `KeyVault` never creates a replacement key on failure. The master key is
  created only while no envelope exists.

**Database key and JS:**
- op-sqlite accepts the SQLCipher key only from JS, so the `database` key
  crosses the bridge as hex. It is dropped from op-sqlite's retained options
  after `open()` and is never logged.
- JS strings can't be wiped (TA §4.4).

**Boundary between JS and Kotlin:**
- **Attachment bytes and the attachments key never pass through JS in normal
  operation.** JS gets only metadata, `file://` URIs of private cache copies
  for display, and error codes.
- **Key access from JS is restricted natively.**
  - `TrezorVaultModule.hasKey`/`createKey`/`getKey` accept only `database`
    (`vault/JsKeyAccess.kt`). Any other id is rejected with
    `INVALID_ARGUMENT` before the vault is touched.
  - The returned value is the unwrapped key as hex, which is why the list
    must stay at `database`.
  - Native code (`ScheduleStore`, `TrezorAttachmentsModule`) uses `KeyVault`
    directly with its fixed ids.

**Attachment encryption, TZA v1** (`AttachmentFormat.kt`):
- **Layout:** header `"TZA1" | version | chunkSize | wrapIv(12) |
  wrappedDek(48) | noncePrefix(7)` (76 bytes), then 64 KiB chunks.
- **Keys:** each file has a **random 256-bit DEK**, wrapped (AES-GCM) by the
  `attachments` key. The AAD for the wrap is `trezor.attachment-dek|1|<id>`.
- **Chunks:** AES-256-GCM. Nonce = prefix ‖ chunk index ‖ last-chunk flag.
  The AAD binds the id, chunk size and nonce prefix.
- **Detected:** tampering, truncation (also at a chunk boundary), appended
  data, reordering, swapping files between ids and the wrong key.
- **Database check:** the database also stores plaintext `size_bytes` and
  `sha256`, checked whenever a file is decrypted for viewing, export or
  sharing.
- **Rewrap:** `rewrap` re-wraps only the DEK and copies the body unchanged,
  for Phase 6 backup.

**Where files live:**

| Location | Content | Lifetime |
| --- | --- | --- |
| `noBackupFilesDir/attachments/<id>.tza` | Encrypted attachment (immutable) | Until its row is deleted and the commit succeeded |
| `noBackupFilesDir/attachments/tmp/<id>.part` | Encrypted import in progress | Deleted on failure; all removed at startup |
| `cacheDir/attachments/view/<32 hex>.view` | **Decrypted** copy for display (photo, PDF, rendered PDF page) | Deleted when the screen unmounts; on foreground, files no screen holds are deleted; at startup, all |
| `cacheDir/attachments/share/<32 hex>/<name>` | **Decrypted** copy offered to another app | Deleted at once if the share sheet couldn't start; otherwise kept ≥ 24 h, then purged at the next startup or foreground return |
| User-chosen SAF document | Decrypted export | User's file; written only to an empty, newly created document |

**Missing or unavailable keys:**
- `attachments` missing and no `.tza` file exists → created on first import.
- Missing while files exist, **or when the store can't be listed**
  (`AttachmentStore.hasAnyFile` fails closed) → `KEY_UNAVAILABLE`. Nothing is
  created or deleted.
- Database key missing with an existing database →
  `KEY_MISSING_FOR_DATABASE`.

**Backup and extraction:**
- `allowBackup="false"`, plus `fullBackupContent` and `dataExtractionRules`
  that exclude every domain from cloud backup and device transfer.
- Keys, the database and attachments are bound to this device's Keystore.
  Uninstalling or clearing storage loses the data (by design until Phase 6).

**Not protected:**
- An attacker running code inside the unlocked app process.
- Recents thumbnails and screenshots: there is no `FLAG_SECURE` (TA §12;
  product decision pending).
- PDFs are parsed in-process by Android's `PdfRenderer`.

---

## E. Attachments

**Limits** (`src/data/attachments.ts`, mirrored in Kotlin):

| Limit | Value |
| --- | --- |
| Size per file | 25 MB (`MAX_ATTACHMENT_BYTES`) |
| Files per document | 10 (`MAX_DOCUMENT_ATTACHMENTS`) |
| Card photos | One front, one back, images only |
| Types | `image/jpeg`, `png`, `webp`, `heic`, `heif`, `application/pdf` |

**Where the rules are enforced:**
- Structural rules: SQL CHECKs.
- Product limits: `attachmentProblem` (TS) and `AttachmentImporter`/
  `MediaTypes` (Kotlin).

**Lifecycle:**

1. **Pick** (`TrezorAttachmentsModule.pick`).
   - `photos` → Photo Picker (`PickVisualMedia` / `PickMultipleVisualMedia`).
   - `files` → `ACTION_OPEN_DOCUMENT` with the supported types.
   - No storage permission is needed. URIs are read once and not kept.
   - One picker at a time (`BUSY`).
   - The editor's `useAttachmentSession` tracks a busy count; **Save is
     disabled** while a pick or import runs.
2. **Validate** (`AttachmentImporter`, `MediaTypes`).
   - The type comes from the first 64 bytes, never from the name or the
     declared type.
   - HEIF uses the whole `ftyp` brand list; AVIF is refused.
   - 25 MB is enforced while reading.
   - Names are cleaned: last path segment, no control or bidi characters,
     120 characters max, an extension added if missing. This is the
     **stored** display name. Copies written outside the store get a
     byte-limited name (steps 8–9).
   - Per-file failures: `TOO_LARGE`, `UNSUPPORTED_TYPE`, `READ_FAILED`
     (including a close failure), `IMPORT_FAILED`. Other files continue
     (`importAll`), and the call always settles.
3. **Encrypt and store** (`AttachmentStore.import`): write `.part`, fsync,
   decrypt it back and compare, then rename atomically. Nothing is left on
   failure. JS gets JSON metadata, re-validated by `parsePickResult`.
4. **Persist metadata.**
   - The draft holds `Attachment` objects. On Save,
     `attachmentSession.commit(keptIds)` runs, then `saveItem`.
   - The repository replaces the item's `attachments` rows in the item's
     transaction.
5. **Replace or remove.**
   - Files picked in this editor session and later dropped → deleted at once.
   - **Stored files** → deleted only **after** the save that drops them has
     committed (`ItemsProvider`).
   - Discard, Cancel or back → every session file deleted.
   - A late pick after the editor closed → deleted.
   - A failed save keeps stored files. New ones become orphans.
6. **Garbage collection.**
   - `openStorage`, after the DB opened and before any UI, calls
     `collectGarbage(listAttachmentIds())`. It removes `.tza` files without
     a row and all `.part` files, purges view copies and expired share
     copies, and never touches files the DB knows.
   - If the DB can't open, nothing is removed.
   - A failure is logged as a code and retried next launch.
7. **View** (`AttachmentViewerScreen`, from detail rows and card tiles).
   - Previous/Next across a card's sides or a document's files.
   - Images: `openView` decrypts and checks into a view file, then
     `ZoomableImage` shows it (`PanResponder`: pinch 1–4×, pan, double-tap
     2.5×).
   - PDFs: `openPdf` → `PdfViews` (`PdfRenderer`) lists page sizes;
     `renderPdfPage` makes PNGs on a dedicated thread at screen width (max
     2048 px / 4 MP). A page is closed when its row unmounts, and
     `closePdf` deletes everything.
   - Errors: missing, damaged, key unavailable, `PDF_PROTECTED`,
     `PDF_UNSUPPORTED`, undisplayable image.
8. **Save a copy** (`AttachmentExport`).
   - Steps: verify, then `ACTION_CREATE_DOCUMENT` with the suggested name from
     `ExportFileNames.forExport` and the stored type, then refuse a destination with content (`DESTINATION_NOT_EMPTY`)
     or of unknown size (`DESTINATION_UNVERIFIED`), then open with `"wt"`
     (`"w"` only if `"wt"` fails on an empty destination) and decrypt
     straight in, checking again.
   - On `DESTINATION_UNVERIFIED` nothing is opened or deleted, because the
     document could be an existing file. The empty document the picker made
     therefore stays, and the UI says so.
   - A failed write deletes the document, or reports `EXPORT_INCOMPLETE` if
     the provider refuses.
9. **Share** (`ShareFiles`, `ShareIntent`).
   - A checked copy goes into the share cache, named by
     `ExportFileNames.forExport`.
   - The FileProvider authority is `com.trezor.app.attachments`, with
     `exported="false"`, `grantUriPermissions="true"`, and its only path
     `cache-path attachments/share/` (`res/xml/attachment_share_paths.xml`).
   - The intent is `ACTION_SEND` with the stored MIME type, `EXTRA_STREAM`,
     `ClipData` and `FLAG_GRANT_READ_URI_PERMISSION` only, sent via
     `createChooser`.
   - If the launch fails, the copy is deleted at once.
   - A share in progress is never purged.

**Export file names** (`ExportFileNames.forExport`, used by Share and Save a
copy, fixed in `6786ceb`):
1. The name is cleaned as on import and lone surrogates are dropped.
2. An extension is added if missing.
3. The name is limited to **200 UTF-8 bytes**: the 255-byte file-name limit
   minus a 55-byte margin.
- The extension is kept, and the base is cut on a code-point boundary.
- An extension over 16 bytes is replaced by the type's own (`.pdf`, `.jpg`, …).
- If nothing of the base remains, it becomes "Document" or "Photo".
- The stored name in the database is never changed.

**Android version limits:**
- HEIC/HEIF decode only on Android 9+; Save a copy and Share still work.
- Password-protected PDFs are not supported (no password entry).
- Photo Picker multi-select needs ≥ 2 slots; with one free slot it is single
  select.

---

## F. Reminders

Detail: TA §13. There is no third-party notification library, no Firebase
and no network. Only `AlarmManager`, `Notification.Builder` and broadcast
receivers are used.

**Recurrence:**
- **Modes:** once, daily, weekly, monthly (short months use the last day,
  without drifting), yearly (29 Feb → 28 Feb) and interval (1, 2, 4, 8 or
  12 h presets; the stored range is 15 min–30 days).
- Calendar modes follow the device's current zone wall clock. ONCE and
  INTERVAL are absolute instants.
- DST gaps move forward; DST overlaps take the earlier instant.
- Missed occurrences are never replayed in a burst.
- The rules are implemented twice, `recurrence.ts` and `Recurrence.kt`, and
  checked against `test-fixtures/recurrence.txt`.

**Scheduling:**
- The DB is the source of truth. `RemindersProvider` reconciles on change
  (300 ms debounce), on launch and on return to the foreground
  (`scheduler.ts`).
  1. Fired ONCE reminders are marked completed.
  2. `sync()` replaces the native schedule.
- Native side (`com.trezor.app.reminders`):
  - `ScheduleStore`: an encrypted record `noBackupFilesDir/reminders/schedule.bin`
    using the `reminders` key, so alarms can be re-armed without JS;
  - `ReminderScheduler`;
  - `ReminderNotifications`: channel `reminders`;
  - `ReminderAlarmReceiver`: not exported;
  - `ReminderRestoreReceiver`: handles `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`,
    `TIME_SET`, `TIMEZONE_CHANGED` and
    `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`, then re-arms everything;
  - `ReminderTaps`: notification tap → detail screen.
- **Delivery:**
  - with "Alarms & reminders" allowed: one `setExactAndAllowWhileIdle`;
  - without it: `setWindow` (10 min) plus `setAndAllowWhileIdle`. These can
    be late (~10 min awake, up to ~1 h idle), and much later under Samsung
    Freecess.
  - The UI explains this once and links to the setting.

**Notification privacy:**
- The "Show reminder details" setting is off by default.
- Off: notifications say "Trezor / You have a reminder." and the text isn't
  even stored natively.
- On: notifications are `VISIBILITY_PRIVATE` with a generic public version.

**Limits:**
- Force-stop removes alarms until the next launch.
- Tested on one physical device (Galaxy A53, Android 16) and the API 37
  emulator.
- Reboot re-arming was verified with approximate alarms only.

---

## G. Current UI and product conventions

Design system: [DESIGN.md](DESIGN.md) ("a quiet drawer"). Tokens are in
`src/theme/tokens.ts`. Screens never define their own colours, sizes or
spacing; compose from `src/components`.

**Screens:**
- **Home:** search entry, counts, "Coming up", pinned and recent items.
- **Category tabs:** list, filter chips, FAB and empty state.
- **Detail:** pin, edit and delete with confirmation.
- **Editor:**
  - modal, with Cancel/Save and inline validation;
  - leaving with unsaved changes asks "Discard changes?".
- **Search:** grouped results, Unicode-aware, done in JS.
- **Settings:**
  - Theme, Notification privacy and the delivery warnings;
  - App lock, backup, restore and delete-all shown as "Not available yet";
  - a debug-only "Show sample data" switch.

**Item UX:**
- **Notes:** title and body.
- **Reminders:** date, time and repeat; plus a description.
- **Cards:**
  - Fields: card name, issuer, number, front/back photos, cardholder and
    notes.
  - The detail shows the number as text with "Card number · No barcode
    saved".
  - **No barcode or QR graphics and no code-type choice** until real scanning
    exists. A stored `code_format` is kept.
- **Documents:**
  - Fields: kind, title, merchant, dates, amount and currency, notes, plus
    up to 10 files.
  - Each file has a ⋮ menu: Move up/down, Replace, Remove.

**Viewer:** Close (X), Previous/Next and a position line. Save a copy and
Share sit at the bottom.

**Messages:**
- Plain sentences at the point of failure (e.g. "Photo file is missing",
  "PDF is password-protected", "“x.docx” isn’t supported…").
- Unavailable features are labelled honestly; nothing pretends to work.

**Unresolved UI issues** (found on the Galaxy A53):
- the tab bar overlaps the Android navigation buttons;
- the keyboard doesn't open for an auto-focused field (e.g. the editor
  Title).

---

## H. Testing and development workflow

**Commands** (scripts from `package.json`):

```sh
npm install
npx tsc --noEmit
npm run lint                 # eslint .
npm test                     # jest: 21 suites, 347 tests at 6786ceb
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # macOS without a system JDK
cd android && ./gradlew :app:testDebugUnitTest   # JVM: 10 classes, 72 tests at 6786ceb
cd android && ./gradlew :app:assembleDebug       # debug APK
npm start / npm run android  # Metro + install (see README for another port)
```

**Jest** (`__tests__/`):
- **Storage:**
  - migrations, the database open matrix and repositories on `node:sqlite`
    (`test-utils/nodeSqlite.ts`);
  - a SQLCipher-export fake (`test-utils/fakeSqlCipher.ts`);
  - `serialDatabase`, ids and `openStorage` cleanup.
- **Data:** drafts, organizer, search and the attachment session.
- **Reminders:** recurrence fixtures and the scheduler.
- **Attachments:** platform parsing and zoom math.
- **App-level flows:** `organizerFlows`, `reminderFlows`, `cardFlows`,
  `documentFlows`, `viewerFlows`.
  - They use `test-utils/appHarness.tsx`, which drives the real screens.
  - Native modules are replaced by `test-utils/fakeAttachments.ts` and
    `fakeReminders.ts` (installed in `jest.setup.js`).
  - These suites are timing-sensitive under heavy parallel load; rerun a
    suite alone before suspecting a regression.

**JVM** (`android/app/src/test/`):
- `attachments/`: `AttachmentFormatTest`, `AttachmentStoreTest`,
  `AttachmentImportRulesTest`, `AttachmentImporterTest`, `AttachmentViewsTest`,
  `AttachmentExportTest`, `ShareFilesTest`, `ExportFileNamesTest`.
- `reminders/RecurrenceTest`.
- `vault/JsKeyAccessTest`.
- Platform-free logic is extracted from Android classes so it can be tested
  here. Keep that pattern.

**Instrumentation** (`connectedDebugAndroidTest`):
- `KeyVaultTest`, `DatabaseFilesTest`, `ReminderSchedulerTest`.
- **Phase 4 ran none of them.** The case added in `04c4605`
  (`nativeCodeKeepsAccessToAttachmentsAndRemindersKeys`) is compiled only.
- They last ran on the API 37 emulator in Phase 3. The exact-alarm case
  added after that has not run.
- ⚠️ **It installs a test APK and uninstalls the app afterwards, erasing its
  data.** Never run it on a device with real user data, such as the
  maintainer's phone, unless explicitly approved. Use a dedicated test
  device or emulator.

**Debug self-test:** dev menu → "Run storage self-test" runs real-SQLCipher
checks on the device (logged with `[SELFTEST]`). It reuses the production
`database` key id.

**Migration on real SQLCipher:**
- Done once for v2 → v3 (TA §5). op-sqlite's bundled
  `cpp/sqlcipher/sqlite3.c` was compiled for macOS with the Android flags,
  and a ctypes bridge drove the production `openTrezorDatabase`.
- **The harness is not in the repository**, so repeating it means rebuilding
  it the same way, with isolated temporary files only.

**Verification levels:** always say which one was reached.
- **Automated:** Jest/JVM.
- **Emulator:** API 37. The shared emulator in this workspace is unstable;
  don't restart or recover it.
- **Physical device.**

Phase 4 has reached the automated level only (Jest, JVM and the one-off
real-SQLCipher migration check). Nothing from Phase 4 has run on an emulator
or a physical device, and no instrumentation test was run.

---

## I. Implementation status

| Phase | Implemented | Reference |
| --- | --- | --- |
| 0 — Foundation and UI | Design system, components, navigation, all screens with in-memory data | DESIGN.md |
| 1 / 1.1 — Encrypted storage | SQLCipher via op-sqlite, Keystore `KeyVault`, startup matrix, verified snapshots, migration procedure, serialized connection, error screen; audit fixes | TA §2–§7, §10.1 |
| 2 — Persistent items and search | Repository CRUD for all four types, pinning, filters and sorts, Unicode search, document expiry, debug sample data | TA §7 |
| 3 — Reminders | Schema v2, six repeat modes, native alarms and notifications, notification privacy, reboot/time-change re-arming, exact alarms (`191ad7f`) | TA §13; commit `147699d` |
| 4 — Cards, documents, attachments | Schema v3, TZA encrypted files, card issuer and front/back photos, up to 10 document files, viewer, save a copy, share, cleanup; review fixes | TA §14; steps `ade411f` … `3982135`, docs `1b15cf4`, review fixes `06004a0`, KeyVault hardening `04c4605`, UTF-8 export names `6786ceb`. Acceptance pending |

**Not implemented** (shown as "Not available yet" or not present):
- app lock and biometrics;
- backup and restore (Phase 6 design only, TA §8);
- delete all data;
- barcode/QR scanning or display;
- camera capture and OCR;
- `FLAG_SECURE`;
- iOS.

---

## J. Known limitations and outstanding verification

**Public-release blockers:**
- Phase 4 has not run on a device or emulator: pickers, Keystore `attachments`
  key, view files and Fresco caching, `PdfRenderer`, the save-to picker and
  providers, FileProvider grants, receiving apps.
  - Installing on the maintainer's phone upgrades its real data to schema v3;
    that needs explicit approval.
  - Instrumentation tests are deferred.
- Release signing still uses the template debug key; R8 is off.
- OpenSSL 3.3.2 comes from a third-party Maven artifact, and there is no
  Gradle dependency verification (TA §12).
- The tab bar overlaps the navigation buttons, and the keyboard doesn't open
  for auto-focused fields.

**Accepted or documented limitations:**
- PDF password protection is unsupported.
- **EXIF metadata (e.g. GPS) is kept** in originals and passed on by Share
  and Save a copy, with no warning.
- Share copies:
  - Android may clear the cache earlier than 24 h;
  - a copy outlives 24 h if Trezor isn't reopened (no background job).
- Some document providers refuse to delete an incomplete export
  (`EXPORT_INCOMPLETE`). Providers that don't report a size are refused
  (`DESTINATION_UNVERIFIED`); which real providers do this is *(unverified)*.
- HEIC/HEIF display needs Android 9+. PDFs have no zoom. Image zoom runs on
  the JS thread.
- The Save-during-import guard relies on React batching two state updates
  (TA §14.5).
- PDFs are rendered in-process.
- There is no `FLAG_SECURE`.
**Findings from the independent Phase 4 review:**
- **Fixed (`6786ceb`), Medium: Share failed for long non-ASCII names.** Export
  names were limited to 120 UTF-16 characters, so a long CJK name (e.g. 352
  bytes) exceeded the 255-byte limit. They are now limited to 200 UTF-8 bytes
  (section E).
- **Fixed, Low: power loss could lose a just-renamed file.** The attachments
  directory is now `fsync`ed after the rename (`DirectorySync`), and an import
  whose sync fails is undone. Before the fix, `AttachmentStore.import` synced
  only the file, so a power loss after the database commit could leave a row
  whose file is missing. The KDoc's "atomic within one directory" was
  inaccurate (`tmp/` is a subdirectory) and has been corrected. The Android
  `Os.fsync` path is untested without a device.
- **Open, Low (guard against future drift): dropped pick records leave
  files.** A
  pick record that fails `parsePickResult` validation is dropped silently, and
  its `.tza` file stays until startup cleanup. Today Kotlin and TS agree, so
  this can't happen yet.
- **Open, Low: calls after the module shuts down.** After `invalidate()` (JS reload
  or host teardown), most `TrezorAttachmentsModule` methods would throw
  `RejectedExecutionException`, and their promises would never settle.
- **Informational:**
  - one worker serializes imports with viewing, export and share preparation,
    so the viewer waits during large imports;
  - card thumbnails decrypt the whole file on every mount;
  - files picked in debug sample-data mode stay until startup cleanup.

- Key loss means data loss until backup exists. Snapshots are never cleaned
  up or restored automatically.

---

## K. Rules for future coding agents

1. **Inspect before assuming.** Read the relevant source and `git log` first;
   docs can lag. Report any code/doc discrepancy you find.
2. **Local-first and private.**
   - No cloud, accounts, analytics, ads, crash reporting, push or network
     access without explicit product approval.
   - Release builds must keep having no `INTERNET` permission.
3. **No new dependency** (npm or Gradle) without a stated reason and
   approval. Prefer platform APIs.
4. **Keys:**
   - never log keys or content (codes only);
   - never pass attachment bytes or the `attachments`/`reminders` keys
     through JS;
   - the `database` key crosses JS only because op-sqlite requires it;
   - never widen `JsKeyAccess`, and never add a JS method that returns other
     key material.
5. **No persistent plaintext.**
   - Decrypted content exists only under `cacheDir/attachments/{view,share}`
     with the documented lifetimes, or in a destination the user explicitly
     chose.
   - Never in `filesDir`, external storage or MediaStore.
6. **Never silently recreate a missing key** when encrypted data may exist.
   If existence can't be determined, fail closed. The same goes for the
   database: never reset, recreate or delete it as recovery.
7. **Order of operations:**
   - import files **before** their row commits;
   - delete files only **after** the transaction removing their row commits;
   - garbage collection only at startup, with the DB's complete id list.
8. **Migrations** are append-only and transactional; keep them additive
   where possible.
   - Never edit a shipped migration.
   - Test against data of every older version, including rollback.
   - Keep the snapshot procedure.
   - Real-SQLCipher checks must use isolated temporary files.
9. **Names outside the store** (share copies, the Save a copy suggestion,
   any future export) must go through `ExportFileNames.forExport`. Limit by
   UTF-8 bytes, never by `String.length`.
10. **Validate in both layers.** Kotlin decides file facts (type by content,
   size). TS validates records before storage. Keep limits identical in
   `src/data/attachments.ts`, `AttachmentImporter`, `MediaTypes` and the
   module.
11. **Never touch real installations destructively.**
    - No `connectedDebugAndroidTest`, uninstall, "clear data" or install
      over the maintainer's device without explicit approval.
    - Don't restart or recover the shared emulator.
12. **Stay in scope.** Don't change unrelated screens, the design system or
    the architecture. Use existing components and tokens.
13. **Small, reviewable steps:**
    - review the diff;
    - run tsc, lint, Jest, JVM and the debug build;
    - commit locally only when green;
    - stop and report after each step if working in phases.
14. **Report exactly.**
    - Give test counts and commands.
    - State what was automated, emulator or device verification.
    - Never claim device verification that didn't happen.
    - Don't weaken or delete tests to make them pass.
15. **Git:**
    - no push, amend, rebase, reset, squash or force-push without explicit
      approval;
    - don't use `git checkout <file>` to undo experiments on files with
      uncommitted work; copy the file first.
16. **Keep platform-free logic testable.** Put Kotlin rules in plain classes
    (as `AttachmentImporter`, `ShareFiles`, `AttachmentExport` do) and keep
    Android glue thin. Put TS rules in pure functions.
17. **Honest UI.** No fake barcodes or decorative codes. Unavailable features
    are labelled. Errors are plain sentences, never silent.

---

## L. Source-of-truth references

| File | Why read it |
| --- | --- |
| `docs/TECHNICAL_ARCHITECTURE.md` | Deep design, verification evidence, schema history, known issues (§12), attachments (§14), reminders (§13) |
| `docs/DESIGN.md` | Visual system, screens, UX decisions |
| `README.md` | Setup, run, checks, privacy summary |
| `src/data/types.ts`, `src/data/attachments.ts` | The item model, attachment limits and validation |
| `src/storage/migrations.ts` | Actual schema (all versions) and migration runner |
| `src/storage/database.ts`, `sqlcipher.ts`, `snapshot.ts` | Open matrix, key handling, verification, snapshots |
| `src/storage/SqliteItemRepository.ts`, `ItemRepository.ts` | All item SQL, attachment row handling, removed-id contract |
| `src/storage/openStorage.ts`, `StorageProvider.tsx` | Startup sequence and attachment garbage collection |
| `src/data/ItemsProvider.tsx` | Optimistic writes, write queue, post-commit file deletion, sample-data isolation |
| `src/screens/editor/attachmentSession.ts`, `fields.tsx`, `ItemEditorScreen.tsx` | Editor file lifecycle, busy/Save guard, card and document attachment UI |
| `src/attachments/platform.ts`, `src/native/NativeTrezorAttachments.ts` | JS contract and error codes of the attachments module |
| `android/.../attachments/TrezorAttachmentsModule.kt` | Native entry points, threads, pickers, SAF, share launch |
| `android/.../attachments/AttachmentFormat.kt`, `AttachmentStore.kt`, `AttachmentKeys.kt` | TZA format, file store and GC, key policy |
| `android/.../attachments/AttachmentViews.kt`, `PdfViews.kt`, `AttachmentExport.kt`, `ShareFiles.kt`, `ShareIntent.kt`, `ExportFileNames.kt` | Decrypted-copy lifecycles, PDF rendering, export and share rules, byte-limited export names |
| `android/.../vault/KeyVault.kt`, `TrezorVaultModule.kt`, `JsKeyAccess.kt` | Master key, envelopes, the JS key API and its allow-list |
| `src/reminders/scheduler.ts`, `RemindersProvider.tsx`, `android/.../reminders/*` | Reminder reconciliation and native scheduling |
| `android/app/src/main/AndroidManifest.xml`, `res/xml/*.xml`, `src/debug/AndroidManifest.xml` | Permissions, receivers, FileProvider, backup exclusions |
| `jest.setup.js`, `test-utils/` | How native modules are faked; app harness |
| `package.json` | Pinned versions, scripts, `op-sqlite` and codegen config |
