# Phase 6 v2.4 — Unresolved questions

## Format and data-safety blockers

**None.** Every byte of the TZBK v1 format is defined (spec §3, Annex A, Annex B). Every restore state has a defined action or fails closed, and every failed recovery action keeps enough state for a safe retry (spec §8.5). No point below can lose, overwrite or expose existing data: each one has a safe fallback or blocks the feature instead.

## Open, needing device evidence or a decision (not blocking approval)

| # | Question | Why it is open | Safe fallback | What resolves it |
|---|---|---|---|---|
| U1 | Is the same-process relaunch (`makeRestartActivityTask` + kill) reliable on API 34–36? | Not verifiable from source | Recovery runs at the next launch; a terminal "close and reopen" screen | Instrumentation on the dedicated AVD (spec §13, test 32); if unreliable, a separately reviewed trampoline process |
| U2 | Does a 64 MiB Argon2id fit and stay under ~5 s on the reference device? | Needs a physical benchmark (F2 needs approval) | The heap pre-check fails with `BACKUP_INSUFFICIENT_MEMORY` before anything is written | Your approval of the benchmark, then 5 runs |
| U3 | The exact `sqlite_master` text under SQLCipher 4.19.0 / SQLite 3.53.4 | Captured only with node:sqlite 3.54.1 | Not needed for correctness within one SQLite version: the normative check compares against the app's runtime reference (Annex B §B.6; across versions see U11) | Re-capture with the SQLCipher harness in Step 2 |
| U4 | SHA-256 of UCD 8.0.0 `DerivedAge.txt` and `UnicodeData.txt` | Recorded when the table is generated | — | Step 1 commits the files' checksums and the generator |
| U5 | Do SAF providers on the reference device report size 0, allow `fsync` and allow read-back? | Provider-specific | Refused providers can't produce a "verified" backup | Device test (test 17) |
| U6 | Does `Os.link` work in app storage on the reference device? | Expected on ext4/f2fs; not verified | Copy fallback (needs Σ kept sizes of space) | Device test (test 22) |
| U7 | Accept that a reboot during an in-progress restore leaves reminders unarmed until the app is opened? | Accepted (review of v2.3) | No data loss; recovery re-arms | — |
| U8 | Confirm the decisions listed in the change log under "Other changes" (16 MiB manifest, refusing a hot journal, the blocking backup UI, hard-link quarantine, ZWJ/ZWNJ allowed) | Decisions | — | Your approval |
| U9 | A future iOS SQLCipher with identical parameters | Outside Phase 6 | The format pins the parameters | iOS phase |
| U10 | After process death, can the app still delete a partial SAF destination (the URI grant may be gone)? | Provider- and Android-specific | The record is cleared anyway and the user is told once that an incomplete file may remain (spec §6.4) | Device test (test 43) |
| U11 | A future op-sqlite/SQLite upgrade that changes rewritten DDL text | Not current: only 19.0.3 has shipped | The schema check fails closed; the upgrade is blocked until a cross-version vector or a reviewed normalization rule exists (Annex B §B.6) | At upgrade time |

## Decided in v2.4 (no longer open)

- No foreground service for long backup/restore (spec §8.10).
- No automatic quarantine cleanup (spec §9.2).
- The backup gate is held through the complete attachment section (spec §6.1).

## Not reproduced from earlier documents on purpose

The v2.1/v2.2 reminder floor and the v2 "grace 0" rule are withdrawn (M1), not open.
