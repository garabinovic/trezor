# Phase 6 Step 4 — Prerequisites and required tests (spec v2.5)

## 1. Prerequisites (each a separate, reviewed local commit, in this order)

| # | Prerequisite | Files (expected) | Done when |
|---|---|---|---|
| P1 | v2.5 approved, including D1–D7 defaults | — | product-owner approval |
| P2 | **M2** attachment gate re-check inside the WORKER/RENDERER lane, keeping the outer check | `TrezorAttachmentsModule.kt` (+ JVM test) | T-K1 passes |
| P3 | **OQ2** `RESTORE_*` codes in `StorageErrorCode` and its known set | `src/storage/errors.ts` (+ Jest test) | T-J7 passes |
| P4 | Restore lock (§5) and typed probe (§3) as standalone units, no caller yet | `restore/RestoreLock.kt`, `restore/PathProbe.kt` | T-K2, T-K3 pass |
| P5 | `P_att` in the deletion allowlist, phase-restricted (§8) | `RestoreFileOps.kt` | T-K4 passes |
| P6 | Real-SQLCipher harness present (`scratchpad/sqlcipher-check/server.py`, `libsqlcipher.dylib`) | scratchpad only | `restore.check.ts` runs with `jest -i` |

Then Step 4 proper: decision function → recovery runner → verifier → steps 13–16 → Cancel restore → `openStorage` integration. No Step 5 UI.

## 2. Tests required before Step 4 is complete

### Kotlin JVM (`./gradlew testDebugUnitTest`, JDK 17)

| ID | Covers |
|---|---|
| T-K1 | M2: a task accepted before `RestoreGate.begin` and run after the drain marker rejects with `RESTORE_IN_PROGRESS` and creates no file |
| T-K2 | H1: begin vs recovery vs begin; refused calls change nothing; `invalidate` waits for an in-flight step, then releases |
| T-K3 | M5: probe returns FILE/DIR/ABSENT/OTHER (symlink)/ERROR (unreadable parent); ABSENT only for ENOENT |
| T-K4 | M3: `P_att` deletable only in `cleanup`; other quarantines, root, `L_*`, `D`, `N` refused |
| T-K5 | Decision function: every row of v2.4 Tables 1 and 2 for `hadAttachments` true/false, plus every single-rename intermediate state |
| T-K6 | Decision function: wrong type at each path, OTHER, ERROR, duplicates (same item in two places) → STATE_UNKNOWN / RECOVERY_RETRY with no action |
| T-K7 | L4: each sidecar beside each of `L_db`/`S_db`/`P_db` in each phase; prepared/none behaviour |
| T-K8 | L5: `pending` in every phase other than `prepared`; `incoming-attachment.tmp` after `prepared` |
| T-K9 | M1: sync order — sync set before classify, before every phase write; both parents after rename; parent after deletion; journal last, empty `N/restore` removed, `N` synced (recording fake) |
| T-K10 | M1: fault injection at every sync and every rename of swap and rollback (failing before and after the rename); re-run converges to the right row; never forward after `rollingback` |
| T-K11 | Idempotence: each row run twice, and interrupted after every action then re-run |
| T-K12 | M4: Cancel offered/refused per §2.1 conditions (each one false in turn); writes only `rollingback`; previous data untouched; re-check at action time |
| T-K13 | L3/§8: cleanup and rolledback leave no `N/restore`; previous data deleted only in cleanup |
| T-K14 | §6: step 13a refusals; failure in each of a–d leads to rollback + rolledback in-process, then restart call |
| T-K15 | `ScheduleRestoreTest` still passes (f518f79 behaviour kept) |

### Jest (`npx jest`)

| ID | Covers |
|---|---|
| T-J1 | OQ1: verifier classification for every code in §1.3 (numeric `code`, message-only `(code N`, no code, unknown code), each vault error, `hasKey` false |
| T-J2 | No `createKey` and no `openTrezorDatabase` during recovery (spies), on every outcome |
| T-J3 | OQ3 ordering: recovery before `openTrezorDatabase`, migrations, `keepUnreferenced`, GC, provider mount, reconcile, scheduling |
| T-J4 | OQ3 after a JS reload (module reset): `initialize` runs recovery again first |
| T-J5 | H1 JS side: `openStorage` waits for a registered `prepareRestore`; `RESTORE_IN_PROGRESS` surfaces as a storage error with Retry |
| T-J6 | L1: after `restartProcess`, no gate release, no listener, no resolve (fake timers flushed) |
| T-J7 | OQ2: the five codes are known storage codes; the screen offers Retry only, plus Cancel only for `RESTORE_VERIFY_RETRY` (D2) with confirmation |
| T-J8 | Steps 13–16 order with mocks: close → sidecar check → 13a → swapping → verifying → restart; every failure ends in restart |

### Real SQLCipher (`scratchpad/sqlcipher-check`, `jest -i`)

| ID | Covers |
|---|---|
| T-S1 | Valid restored v3 database passes; wrong key → 26 → rollback class; truncated/zeroed page → 26/11; missing file + `failOnCreate` → 14 → transient |
| T-S2 | L6: reference built from migrations ≤ 3 equals the v3 schema even when a migration 4 is added in the test |
| T-S3 | id-set mismatch (extra/missing `.tza`) → deterministic |

### Device (release QA build, dedicated AVD only — needs explicit approval per run)

| ID | Covers |
|---|---|
| T-D1 | Process kill at each phase (`prepared`, `swapping` after each rename, `verifying`, `cleanup`, `rollingback`) → correct recovery on next start |
| T-D2 | Restart after step 16 opens the restored data; no old UI visible |
| T-D3 | Cancel restore from an induced `RESTORE_VERIFY_RETRY` returns the previous data |

Device tests show process-death behaviour only, not power loss (§11). Never on the Samsung A53 or `emulator-5554`.

### Gates

`npx tsc --noEmit`, `npx eslint`, full Jest suite, full JVM suite, release `assembleRelease` build. No existing test weakened.
