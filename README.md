# Trezor

A private, offline-first personal organizer for notes, reminders, loyalty cards
and documents. No account, no ads, no cloud.

**Status:** Phase 1 — encrypted local storage. Items and settings are stored in
a SQLCipher database whose key is protected by Android Keystore.

- [docs/DESIGN.md](docs/DESIGN.md) — design system and UX decisions
- [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) — storage, security, schema, migrations
- [docs/SQLCIPHER_SPIKE.md](docs/SQLCIPHER_SPIKE.md) — SQLCipher compatibility results

## Stack

React Native 0.88 (bare CLI, TypeScript, New Architecture), React Navigation 7,
Lucide icons, op-sqlite 19.0.3 with SQLCipher, a Kotlin Android Keystore module
(`TrezorVault`).

## Run on Android

Requirements: Node ≥ 22, Android SDK, a JDK (Android Studio's bundled JDK works).

```sh
npm install
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # macOS, if no system JDK

npm start                 # Metro on :8081
npm run android           # build, install and launch
```

If the native module is reported missing after changing `src/native/`, delete
`android/app/.cxx` and rebuild (stale CMake cache).

If port 8081 is taken by another project, use another port for both:

```sh
npx react-native start --port 8090
npx react-native run-android --no-packager --port 8090
```

## Checks

```sh
npx tsc --noEmit
npm run lint
npm test                                            # Jest, incl. SQL via node:sqlite
cd android && ./gradlew :app:connectedDebugAndroidTest   # Keystore tests; needs emulator, uninstalls the app
```

Debug builds add **Run storage self-test** to the React Native dev menu: on-device
SQLCipher checks (wrong key, migrations, encrypted snapshot). Results are logged
with the `[SELFTEST]` prefix (`adb logcat -s ReactNativeJS`).

## Structure

```
src/
  theme/        tokens (colour, type, spacing, radius) + ThemeProvider
  components/   reusable UI: Text, Button, ListItem, TextField, Dialog, Sheet, …
  data/         domain types, formatters, sample data, ItemsProvider
  storage/      encrypted database, migrations, repositories, key vault wrapper
  native/       TurboModule specs (codegen)
  navigation/   root stack + bottom tabs, typed routes
  screens/      Home, category tabs, detail, editor, search, settings
android/app/src/main/java/com/trezor/app/vault/   Keystore key vault (Kotlin)
test-utils/     node:sqlite adapter for Jest
docs/           design, architecture, spike results
```

## Privacy

- Release builds declare no `INTERNET` permission; it exists only in the debug
  manifest so the app can load its bundle from Metro during development.
- All data is encrypted at rest (SQLCipher). The database key is wrapped by a
  non-exportable Android Keystore key and stored in `noBackupFilesDir`.
- App data is excluded from Android cloud backup and device-to-device transfer.
