# Trezor — Current status (Android MVP)

State described: `main` at `22a06ed` plus the documentation commit that adds
this file (2026-11-10). Check it with `git log --oneline -3`. This is the one
place for the current status; [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
(TA) has the detail and the evidence.

**Platform: Android only.** The iOS project exists (`ios/`) but has no native
modules, so none of the features below works on iOS (see "Not implemented").

## Implemented and tested

Automated at `22a06ed`:

| Suite                        | Result                                       |
| ---------------------------- | -------------------------------------------- |
| Jest                         | 510/510 in 34 suites                         |
| Android JVM                  | 317/317 (`./gradlew :app:testDebugUnitTest`) |
| TypeScript, ESLint, Prettier | clean                                        |
| Debug and release builds     | both succeed                                 |

Emulator runs used release builds on dedicated, disposable AVDs (API 36),
never a shared emulator.

| Feature                                                                                                          | Where                                                                           | Verified                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Notes, reminders, cards, documents: create, edit, delete, pin, search                                            | `src/screens`, `src/data`, `src/storage`                                        | Jest app flows; emulator; the Phase 3 build also ran on the maintainer's phone                                                      |
| Encrypted database (SQLCipher 4.19.0 via op-sqlite 19.0.3), Keystore key vault, verified pre-migration snapshots | `src/storage`, `android/.../vault`                                              | Jest, JVM; migration v2→v3 on real SQLCipher (macOS harness); emulator                                                              |
| Reminders: alarms, notifications, exact-alarm handling, re-arming after reboot or time change                    | `src/reminders`, `android/.../reminders`                                        | Jest, JVM; Phase 3 on the emulator and one physical phone; Phase 7 emulator run (fired notification, scheduled alarm, cancellation) |
| Encrypted attachments (TZA): import from pickers, viewer, Save a copy, Share                                     | `android/.../attachments`                                                       | JVM, Jest; import and viewing on the emulator (Phases 6–7); Save a copy and Share not run on Android                                |
| Encrypted backup (TZBK v1), Check backup, Replace-only restore with crash recovery and Cancel restore            | `src/backup`, `android/.../backup`, `android/.../restore`, `src/screens/backup` | JVM, Jest, real-SQLCipher harness; end to end on the emulator (TA §8.8, §8.9)                                                       |
| App Lock (BiometricPrompt, device-credential fallback), `FLAG_SECURE` while locked or not in front               | `android/.../lock`, `src/lock`                                                  | JVM, Jest; emulator with a PIN (TA §15.5)                                                                                           |
| Delete all data, with interrupted-deletion recovery                                                              | `src/storage/deleteAll.ts`, `android/.../restore/DataWipe.kt`                   | JVM, Jest; emulator end to end (TA §16.5)                                                                                           |

## Implemented with limited validation

- **Phases 4–7 have not run on a physical device.** The maintainer's
  Samsung A53 has an older build with real data. Installing on it needs
  explicit approval (see the signing finding below).
- **Biometric unlock** (fingerprint or face) was never exercised. Only the
  PIN fallback ran, on an emulator.
- **Only API 36 emulators** were used for Phases 5–7. Nothing ran below
  API 36 or on Android 8–13.
- **Process kills** were tested by timing on the emulator; they can't land
  between individual swap renames. Crash atomicity of renames (assumption
  A6) and power-loss behaviour are not proven (TA §8.7.1).
- **Restore on another installation or signing certificate** (spec test 34)
  is not tested.
- **Instrumentation tests** (`connectedDebugAndroidTest`) last ran in
  Phase 3. They uninstall the app, so they are never run on the maintainer's
  device.
- **Argon2id cost** (64 MiB, t=3) was not measured on a physical device
  (open question U2).
- **SAF providers:** saving a backup to the **Downloads root** fails closed
  (`DESTINATION_UNVERIFIED`) on the API 36 emulator; device storage works.
  Other providers are untested.
- **Debug builds** don't start on the available emulators (React Native dev
  path: `PlatformConstants could not be found`; also a clean RN 0.88.1
  template). Release builds do. On devices this is _(unverified)_.
- **The real-SQLCipher harness** lives outside the repository, in a session
  scratchpad (IMPLEMENTATION_GUIDE §H). It must be rebuilt to repeat those
  checks.

## Not implemented

- **iOS native functionality:** vault, database files, reminders,
  attachments, backup, restore, App Lock and Delete all data. No native
  module exists for iOS, so the JS app can't start there. App Lock
  requirements are in TA §15.6.
- **Barcode/QR scanning or display, camera capture, OCR.** A card's
  barcode/QR choice is saved, but no code is displayed.
- **Merge restore** (Replace-only by design), cloud sync and accounts (out of
  scope by principle).
- **Browsing or removing quarantined files** outside Delete all data.

## Known limitations (accepted or documented)

- App Lock is access control for the UI only: no key is bound to
  authentication (TA §15).
- Delete all data empties the database in place and keeps the keys. It is
  not a cryptographic erase; flash storage may keep old encrypted blocks
  (TA §16).
- Photo EXIF metadata (e.g. location) is kept in originals, Save a copy and
  Share.
- Share copies are plaintext in the app cache for about 24 hours (longer if
  Trezor isn't reopened).
- A reboot while a restore journal exists leaves reminders unarmed until
  Trezor is opened (U7).
- Real-device UI issues seen on the A53 in Phase 3:
  - the tab bar overlapped the system navigation (fixed in `8d728c3`; not
    re-checked on the device);
  - auto-focused fields don't open the keyboard;
  - card barcode content isn't shown.
- Notification permission and exact alarms: without "Alarms & reminders",
  Android may deliver reminders late (TA §13).

## Release findings (audit of `22a06ed`)

| #   | Severity    | Finding                                                                                                                                                     | Evidence                                                                                                                                                                                                                                                                                                                      | Fix needs                                                                          |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **Blocker** | Release builds are signed with the public React Native debug key                                                                                            | `android/app/build.gradle` release `signingConfig signingConfigs.debug`; the release APK's certificate is `CN=Android Debug` (SHA-256 `FA:C6:17:…:3B:9C`, the same as `android/app/debug.keystore`). The `TREZOR_RELEASE_*` properties in the developer's `~/.gradle/gradle.properties` are not referenced by any Gradle file | Code (Gradle); see "Next recommended work"                                         |
| 2   | High        | Switching to the release key changes the signature: an existing install signed with another key can't be updated in place, and uninstalling erases its data | Android signature rules; the signer of the A53's current install is _(unverified)_                                                                                                                                                                                                                                            | Process: make a verified backup on the device first, then restore after installing |
| 3   | High        | No physical-device run of Phases 4–7 (attachments, backup and restore, App Lock, Delete all data)                                                           | This file, TA §8.8, §15.5, §16.5                                                                                                                                                                                                                                                                                              | Validation, with approval                                                          |
| 4   | Medium      | R8/minification is off in release (`enableProguardInReleaseBuilds = false`)                                                                                 | `android/app/build.gradle`; keep rules exist only for BouncyCastle                                                                                                                                                                                                                                                            | Accept, or enable and re-test the release build                                    |
| 5   | Medium      | Version metadata is inconsistent: `versionCode 1`, `versionName "1.0"`, while Settings shows "0.1.0 (preview)" (hard-coded)                                 | `android/app/build.gradle`, `src/screens/SettingsScreen.tsx`                                                                                                                                                                                                                                                                  | Code (small)                                                                       |
| 6   | Medium      | OpenSSL 3.3.2 comes from a third-party Maven artifact pulled by op-sqlite; no Gradle dependency verification                                                | TA §11, §12                                                                                                                                                                                                                                                                                                                   | Accept or add verification                                                         |
| 7   | Medium      | op-sqlite 19.0.3 is patched (`patches/`, `postinstall`); upgrading op-sqlite must re-check the patch                                                        | `patches/@op-engineering+op-sqlite+19.0.3.patch`                                                                                                                                                                                                                                                                              | Process                                                                            |
| 8   | Medium      | The validation gaps above (biometrics, API levels, providers, Argon2 on a device)                                                                           | This file                                                                                                                                                                                                                                                                                                                     | Validation                                                                         |
| 9   | Low         | Settings "About" says "Your data never leaves this device", but backups, Save a copy and Share leave it when the user chooses                               | `src/screens/SettingsScreen.tsx`                                                                                                                                                                                                                                                                                              | Copy change                                                                        |
| 10  | Low         | `ReminderRestoreReceiver` is exported (system broadcasts); it only re-arms existing alarms, so a spoofed broadcast is harmless                              | `AndroidManifest.xml`, `ReminderReceivers.kt`                                                                                                                                                                                                                                                                                 | None                                                                               |

Checked and fine:

- **Permissions:** the release manifest has no `INTERNET` (only the debug
  manifest adds it). Release permissions are `POST_NOTIFICATIONS`,
  `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, plus `USE_BIOMETRIC` and
  `USE_FINGERPRINT` from `androidx.biometric`.
- **Backups:** `allowBackup="false"`, with backup and extraction rules.
- **Exported components:** the `FileProvider` is not exported; only the
  launcher activity and the restore receiver are.
- **Release APK:** not debuggable. Debug-only code (self-test menu, sample
  data) is gated by `__DEV__`.
- **Identity:** app name "Trezor", custom launcher icon (`24d5673`),
  `applicationId com.trezor.app`.
- **SDK levels:** minSdk 24, target 36, compile 37.

## Verdict

**Not ready for a public release: one blocker (release signing, #1).** Once
release signing is configured, with a migration plan for existing installs
(#2), it is **ready for final release preparation with explicitly accepted
limitations**. Physical-device validation (#3) should be done before any
public release.

## Next recommended work

1. **Release preparation:**
   - wire the release signing config to the `TREZOR_RELEASE_*` properties
     (never commit the keystore or passwords);
   - set the version name and code, and align the Settings version text;
   - decide on R8;
   - rebuild and run the release checks.
2. **Physical-device validation**, only with explicit approval:
   - make a verified backup on the A53 first;
   - then attachments, backup, Check and restore, App Lock with biometrics,
     Delete all data, and the UI issues listed above.
3. **Fix the device UI issues** (keyboard autofocus, card code display) if
   they are in the MVP scope.
4. **iOS** as a separate, later effort: native modules first, then
   LocalAuthentication (TA §15.6).
