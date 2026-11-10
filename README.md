# Trezor

A private, offline-first personal organizer for notes, reminders, loyalty cards
and documents. No account, no ads, no cloud.

**Status:** Android MVP feature-complete, before release preparation. Current
status, validation gaps and release findings: **[docs/STATUS.md](docs/STATUS.md)**.
iOS is not implemented (no native modules yet).

- **Organizer:** notes, reminders, cards (issuer, front and back photos) and
  documents (up to 10 photos or PDFs); pinning and Unicode search.
- **Storage:** a SQLCipher database whose key is protected by the Android
  Keystore. Attachments are encrypted files, each with its own key.
- **Reminders:** once, daily, weekly, monthly, yearly or at an interval,
  through Android's own alarms. Notification text is generic unless "Show
  reminder details" is on.
- **Encrypted backups:** Back up to a file, Check a backup, and Restore
  (Replace-only, crash-safe). TZBK v1 files, encrypted with a password the
  user chooses.
- **App Lock:** the device's fingerprint, face or screen lock (BiometricPrompt).
- **Delete all data:** empties everything on the device; backup files are
  kept.

## Documentation

| File                                                             | Purpose                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                           | Short handoff for a new session: invariants, commands, restrictions                                       |
| [docs/STATUS.md](docs/STATUS.md)                                 | What is done, how it was verified, limitations, release findings                                          |
| [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md)     | Orientation and the rules for changing the code (§K)                                                      |
| [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) | Detailed architecture, security model and verification evidence                                           |
| [docs/DESIGN.md](docs/DESIGN.md)                                 | Design system and UX decisions                                                                            |
| [docs/history/](docs/history/)                                   | Historical records: the Phase 6 backup/restore specification (its TZBK v1 format part is still normative) |
| [docs/SQLCIPHER_SPIKE.md](docs/SQLCIPHER_SPIKE.md)               | Historical: the Phase 1 SQLCipher spike                                                                   |
| [tools/backup-format/README.md](tools/backup-format/README.md)   | TZBK reference implementation and test vectors                                                            |

## Stack

React Native 0.88 (bare CLI, TypeScript, New Architecture, Hermes), React
Navigation 7, Lucide icons, op-sqlite 19.0.3 with SQLCipher (patched through
`patches/`, applied by `postinstall`).

Kotlin TurboModules: `TrezorVault` (Keystore), `TrezorDatabaseFiles`,
`TrezorReminders`, `TrezorAttachments`, `TrezorBackup`, `TrezorRestore`,
`TrezorAppLock`. Native dependencies: BouncyCastle 1.79 (Argon2id, HKDF) and
`androidx.biometric` 1.1.0.

## Run on Android

Requirements:

- Node ≥ 22.11 (`engines`);
- the Android SDK (compile 37, target 36, min 24) and NDK 27.1;
- JDK 17. The builds and tests in this repository were run with a JDK 17
  selected through `JAVA_HOME`.

```sh
npm install               # also applies the op-sqlite patch (postinstall)
npm start                 # Metro on :8081
npm run android           # debug build, install and launch
```

- **Debug builds on emulators:** they don't start on the API 36/37 emulators
  used so far (`PlatformConstants could not be found`, also with a clean
  RN 0.88.1 template). Release builds work; test on emulators with a
  release build.
- **Native module reported missing** after changing `src/native/`: delete
  `android/app/.cxx` and rebuild (stale CMake cache).
- **Port 8081 taken:** use another port for both:

  ```sh
  npx react-native start --port 8090
  npx react-native run-android --no-packager --port 8090
  ```

### Release build

```sh
cd android && ./gradlew :app:assembleRelease    # android/app/build/outputs/apk/release/app-release.apk
```

⚠️ The release build is currently **signed with the debug keystore**
(`android/app/build.gradle`). It is not publishable until release signing is
configured (docs/STATUS.md, finding 1). Never commit signing keys or
passwords.

## Checks

```sh
npx tsc --noEmit
npm run lint
npm test                                                  # Jest, incl. SQL via node:sqlite
npx prettier --check <changed files>
cd android && ./gradlew :app:testDebugUnitTest            # JVM: format, crypto, backup, restore and recovery, lock policy, wipe
cd android && ./gradlew :app:connectedDebugAndroidTest    # instrumentation; ⚠️ uninstalls the app: dedicated emulator only
```

Debug builds add **Run storage self-test** to the React Native dev menu
(on-device SQLCipher checks, logged with the `[SELFTEST]` prefix).

## Structure

```
src/
  theme/ components/   design tokens, ThemeProvider, reusable UI
  data/                domain types, formatters, ItemsProvider (write queue)
  storage/             database open, migrations, snapshots, repositories,
                       openStorage (startup order), deleteAll (Delete all data)
  reminders/           recurrence, reconciliation, reconcile gate
  attachments/         attachment platform wrapper, viewer helpers
  backup/              backup, Check, restore and recovery (JS halves)
  lock/                App Lock provider and lock screen
  native/              TurboModule specs (codegen)
  navigation/ screens/ routes and screens (incl. backup/ and the storage-error screen)
android/app/src/main/java/com/trezor/app/
  vault/ storage/      Keystore key vault, database file operations
  reminders/           alarms, notifications, encrypted schedule
  attachments/         TZA files, pickers, viewer, PDF, Save a copy, share
  backup/ restore/     TZBK format, backup and Check, restore, recovery, DataWipe
  lock/                App Lock (BiometricPrompt, window privacy)
patches/               op-sqlite 19.0.3 fix (worker thread-id reuse)
test-fixtures/ test-utils/   shared cases, node:sqlite adapter, SQLCipher fake, native fakes
tools/backup-format/   TZBK reference and vectors
```

## Privacy

- **No network:** release builds declare no `INTERNET` permission; only the
  debug manifest adds it, for Metro.
- **Release permissions:**

  - `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`
    (reminders);
  - `USE_BIOMETRIC` and `USE_FINGERPRINT` (from `androidx.biometric`, for
    App Lock).

  Attachments need no permission: the Photo Picker and the document picker
  grant only the chosen files.

- **Encryption at rest:**
  - the database is encrypted with SQLCipher, and its key is wrapped by a
    non-exportable Android Keystore key, in `noBackupFilesDir`;
  - each attachment has its own key, wrapped by a Keystore-protected key.
- **Excluded from Android cloud backup** and device-to-device transfer.
- **Decrypted copies** exist only in the app's private cache: while a file
  is shown, and after sharing for about 24 hours (the receiving app may read
  it later).
- **Save a copy, Share and backup files** are written only where the user
  chooses. Backups are encrypted with the user's password (Argon2id, AES-GCM);
  shared files go through a non-exported `FileProvider`.
- **Originals are kept exactly**, including photo metadata such as location
  (EXIF).
- **App Lock** hides the app and blocks screenshots and the Recents preview
  while locked or in the background. It doesn't change the encryption.
- **Delete all data** removes all content and files on the device. It keeps
  the keys and the backup files outside the app.
- **Reminder delivery:** with "Alarms & reminders" allowed, reminders arrive
  on time. Without it, Android may deliver them late.
