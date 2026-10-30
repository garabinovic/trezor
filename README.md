# Trezor

A private, offline-first personal organizer for notes, reminders, loyalty cards
and documents. No account, no ads, no cloud.

**Status:** Phase 0 — design foundation. Data is in-memory sample data; nothing
is persisted. See [docs/DESIGN.md](docs/DESIGN.md) for the design system and
UX decisions.

## Stack

React Native 0.88 (bare CLI, TypeScript), React Navigation 7, Lucide icons.

## Run on Android

Requirements: Node ≥ 22, Android SDK, a JDK (Android Studio's bundled JDK works).

```sh
npm install
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # macOS, if no system JDK

npm start                 # Metro on :8081
npm run android           # build, install and launch
```

If port 8081 is taken by another project, use another port for both:

```sh
npx react-native start --port 8090
npx react-native run-android --no-packager --port 8090
```

## Checks

```sh
npx tsc --noEmit
npm run lint
npm test
```

## Structure

```
src/
  theme/        tokens (colour, type, spacing, radius) + ThemeProvider
  components/   reusable UI: Text, Button, ListItem, TextField, Dialog, Sheet, …
  data/         domain types, formatters, sample data, in-memory ItemsProvider
  navigation/   root stack + bottom tabs, typed routes
  screens/      Home, category tabs, detail, editor, search, settings
docs/DESIGN.md  design direction and rationale
```

## Privacy

Release builds declare no `INTERNET` permission; it exists only in the debug
manifest so the app can load its bundle from Metro during development.
