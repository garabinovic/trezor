# Trezor — session handoff

Read this first, then [docs/STATUS.md](docs/STATUS.md) (current state and
release findings). [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md)
§K has the full coding rules, and
[docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) (TA) the
detail. Where docs and code disagree, the code wins.

## Product

A private, local-first organizer: notes, reminders, loyalty cards, documents
with attachments. Principles:

- no account, cloud, ads, analytics or network;
- encrypted at rest;
- user-controlled encrypted backups;
- a simple UI;
- security proportional to a personal organizer.

**Android is the only working platform.** iOS has no native modules.

## Start of every session

```sh
git status && git log --oneline -5 && git rev-list --count origin/main..HEAD
```

The MVP milestone is `22a06ed` (Phase 7) plus the documentation commit.
Nothing is pushed. Report any difference before working.

## Architecture in one screen

- **Stack:** React Native 0.88 (New Architecture, Hermes, TypeScript).
  Kotlin TurboModules (specs in `src/native/`, codegen `TrezorSpec`): vault,
  database files, reminders, attachments, backup, restore, App Lock.
- **Database:** SQLCipher via op-sqlite **19.0.3**, patched in `patches/`
  and applied by `postinstall`. It holds the items, the settings and
  `user_version` (schema v3, `src/storage/migrations.ts`). One serialized
  live connection (`serialDatabase.ts`).
- **Keys:** the Keystore master key `trezor.master.v1` wraps the `database`,
  `attachments` and `reminders` keys (`N/keys/*.key.json`). Only `database`
  crosses into JS.
- **Files:** attachments are TZA files in `N/attachments` (AES-256-GCM, a key
  per file). Decrypted copies exist only in `cache/attachments/{view,share}`.
- **Backups:** TZBK v1 files, written and read through SAF (TA §8; format in
  `docs/history/phase6-spec/`).
- **Startup order** (`src/storage/openStorage.ts`, don't reorder):
  1. `settleRestore`;
  2. restore recovery (`recoverRestore`);
  3. `openTrezorDatabase` (migrations with snapshots);
  4. `resumeWipe`;
  5. load the initial data;
  6. attachment GC;
  7. then the providers mount (reminder reconcile).
- **Lock order** for restore and Delete all data: the restore lock
  (`RestoreLock`), then the reconcile gate, then the database gate
  (`exclusive`), then the native attachment gate (`RestoreGate`).
- **App Lock** (`android/.../lock`): the native state is the truth, and only
  a BiometricPrompt success unlocks. `FLAG_SECURE` applies while locked, not
  resumed or unfocused. The preference is in SharedPreferences, not the
  database or backups.

## Invariants (don't break)

- **Never recreate** a missing key or database when data may exist. Fail
  closed.
- **No plaintext** outside the documented caches or a destination the user
  chose. No secrets or content in logs.
- **No `INTERNET`** permission in release builds.
- **TZBK v1 and the key architecture are fixed.** Changes need a new format
  version or design review.
- **Restore is Replace-only.** The journal state machine and recovery ordering
  are normative (TA §8.7.1).
- **Delete all data:** `wipe.pending` is set in the deleting transaction, and
  `CONTENT_TABLES` must list every new content table (a schema test
  enforces it).
- **Migrations** are append-only; keep the snapshot procedure.

## Commands (verified)

```sh
npm install                         # also applies patches/ (postinstall)
npm start                           # Metro
npm run android                     # debug build + install (see STATUS: debug may not start on emulators)
npx tsc --noEmit && npm run lint && npm test
npx prettier --check <changed files>
cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease
```

## Operational restrictions

- **Git:** never push, amend, rebase, reset or rewrite history without
  explicit approval. Commit locally only when the checks are green.
- **The maintainer's Samsung A53:** never install, uninstall, clear data,
  migrate or run instrumentation tests on it without explicit approval. It
  has real data.
- **Emulators:** use only a dedicated, disposable AVD (e.g.
  `Trezor_Step4_QA_API36`) for destructive tests. Never use the shared
  emulator (`emulator-5554`).
- **Signing:** never read, print, copy or commit signing keys or passwords
  (`~/.trezor-keys`, `~/.gradle/gradle.properties`).
- **Scope:** small, reviewable steps; no broad refactoring or new
  dependencies without approval. Report exactly what was automated,
  emulator or device verified.
