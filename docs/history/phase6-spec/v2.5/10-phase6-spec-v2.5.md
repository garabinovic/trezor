# Trezor — Phase 6: Encrypted Backup & Restore
## Technical Specification v2.5 (amendment to v2.4)

**Status:** Draft — pending product-owner approval
**Base:** v2.4 (`../v2.4/10-phase6-spec-v2.4.md` and its annexes), which stays unchanged. v2.5 = v2.4 **plus** this document. Where this document and v2.4 differ, this document applies; every such difference is listed in §0.2. Sections of v2.4 not named here apply unchanged, including the TZBK v1 and TZA v1 formats, all cryptographic parameters, Replace-only restore, quarantine isolation, the no-overwrite rename principle and the §8.5 state tables (extended here, never replaced).
**Scope:** everything Step 4 (§8.2 steps 13–16, §8.5) needs that v2.4 leaves open, plus the Step 3 clarification already shipped (§8.11 order). Sources: the two Step 4 reviews of 2026-11-10 (findings H1–H2, M1–M6, L1–L7) and decisions OQ1–OQ3, M4.
**Conventions:** as v2.4. `D`, `N`, `L_db`, `S_db`, `P_db`, `L_att`, `S_att`, `P_att` as v2.4 §2. "The lock" is the restore lock of §5.

---

# 0. Overview of changes

## 0.1 Summary

| § | Change | Source |
|---|---|---|
| 1 | Verification of the restored database in `verifying`: a separate verifier with a fixed error classification | OQ1, H2, L6 |
| 2 | User action "Cancel restore and return to previous data" in `verifying` | M4 |
| 3 | Typed file-state probe replacing `exists()`; sidecar files; `pending` and temp files in late phases | M5, L4, L5 |
| 4 | Directory durability: which directories are synced, when, and what a failed sync means | M1, M6 |
| 5 | Restore lock: no recovery concurrent with a restore session, gate or another recovery | H1, L7 |
| 6 | Restoring process: §8.2 steps 13–16 in detail | L1, v2.4 §8.2 |
| 7 | Startup recovery procedure and its ordering | OQ3, v2.4 §8.5 |
| 8 | Cleanup and rolledback details: `P_att` deletion, empty `N/restore` | M3, L3 |
| 9 | Schedule restore order (normative form of the Step 3 clarification) | Step 3 review L-A, Low 1 |
| 10 | Error codes and the basic recovery UI | OQ2, L2 |
| 11 | Filesystem assumption A6, restated | M6 |
| 12 | Prerequisites before Step 4 code | M2 |
| 13 | Debug/release applicability | L7 |

## 0.2 Differences from v2.4 (explicit)

1. **v2.4 §8.5 `verifying` row** lists "Deterministic failure → rollingback". v2.5 §2 adds a second, user-initiated transition `verifying → rollingback` (Cancel restore). The row's other outcomes are unchanged.
2. **v2.4 §8.5 "every other combination is `RESTORE_STATE_UNKNOWN`"** is kept and made concrete by the typed probe (§3): wrong types, `ERROR` results and sidecar files are defined, and an `ERROR` result is `RESTORE_RECOVERY_RETRY` (not `RESTORE_STATE_UNKNOWN`), because a failed `stat` is not a known state.
3. **v2.4 §8.2 step 13 / 13a** check only `D/trezor.db-journal`. v2.5 §3.3 checks `-journal`, `-wal` and `-shm` beside `L_db`, `S_db` and `P_db` (stricter).
4. **v2.4 §8.11 `restoreAndRearmSchedule`** lists "2. rearmAll, 3. delete schedule.saved.bin". v2.5 §9 makes the shipped order normative: copy back, delete and sync, then re-arm (Step 3 commits `86fb3d5`, `f518f79`).
5. **v2.4 Annex B §B.6** says the reference schema is the one "the same app build produces when it runs its own migrations". v2.5 §1.4 restricts the reference used for restored and staged databases to the build's migrations **up to version 3**, so an app update between interruption and recovery can't make a valid v3 restore fail (L6).
6. **v2.4 §8.10/§8.2 step 16** do not say what JS does after the restart call. v2.5 §6.5 forbids any further JS activity (L1).
7. **New code** `RESTORE_IN_PROGRESS` on the startup path (§5); v2.4 has none there. (Step 3 already uses it for refused attachment work.)
8. **v2.4 §8.5** places no rule on concurrent actors. v2.5 §5 adds the restore lock.

No row of the v2.4 §8.5 tables is removed or changed.

---

# 1. Verifying the restored database (OQ1, H2, L6)

## 1.1 Who verifies

In phase `verifying`, after the probe of §3 has matched the `verifying` row, JS verifies `L_db` with a **dedicated verifier** (`verifyRestoredDatabase`). The Step 2 function `verifyArtifact` MUST NOT be used unchanged, because it turns every open or read failure into `BACKUP_CORRUPT` (`src/backup/artifact.ts:89-99,141-142`). The verifier may share its individual checks.

Rules:
- The device database key is read with `vault.getKey('database')`. If `vault.hasKey('database')` is false, the result is `RESTORE_UNAVAILABLE` (§1.3). Recovery MUST NEVER create a key (`createKey`), for any key id.
- `L_db` is opened on a **separate** connection with `failOnCreate` (it is never created). `openTrezorDatabase` MUST NOT be called before verification has passed and the journal is gone (it may migrate, snapshot or create).
- The verifier runs the checks of Annex B §B.4 with the reference of §1.4, then compares `SELECT id FROM attachments` with the `.tza` ids that native code lists in `L_att` (§1.5).

## 1.2 Error source

op-sqlite rejects with an error that carries the SQLite **primary** result code (`error.code`, numeric) and the extended code, and whose message contains `(code N` (op-sqlite `cpp/OPUtils.cpp:360-371`, `cpp/OPSqlite.cpp:103-104`). The verifier takes `code & 0xFF` when a numeric code is present, else parses `(code N`, else treats the error as having **no code**. A closed connection throws without a code (`cpp/OPDatabase.cpp:182-185`).

## 1.3 Classification (normative)

| Outcome | When | Journal | Result |
|---|---|---|---|
| **Deterministic → rollingback** | SQLite primary code **26** (NOTADB) or **11** (CORRUPT) from open or any statement; or a check result fails: a cipher setting differs (§B.2), `cipher_integrity_check` returns rows, `integrity_check` ≠ exactly `ok`, `foreign_key_check` returns rows, `user_version` ≠ 3, schema ≠ reference (§1.4), the `attachments.id` set ≠ the `.tza` id set of `L_att` | `rollingback` written durably (§4) | rollback rows run |
| **Transient → keep** | primary codes **5** BUSY, **6** LOCKED, **7** NOMEM, **8** READONLY, **9** INTERRUPT, **10** IOERR, **13** FULL, **14** CANTOPEN, **21** MISUSE; an error with no code; any **other** code not listed in this table; a native listing error (§1.5); vault `KEYSTORE_UNAVAILABLE` or `STORAGE_ERROR` | kept at `verifying` | `RESTORE_VERIFY_RETRY` |
| **Key → keep everything** | vault `KEY_NOT_FOUND`, `MASTER_KEY_MISSING`, `KEY_INVALIDATED`, `UNWRAP_FAILED`, `INVALID_KEY_FORMAT`; `hasKey('database')` false | kept | `RESTORE_UNAVAILABLE` (no rollback either: `P_db` needs the same key) |

Unlisted codes are transient on purpose: the cost of a wrong "transient" is a Retry (and §2's Cancel), the cost of a wrong "deterministic" is a discarded valid restore.

**Known limitations (accepted):**
- **Code 26 is ambiguous**: a wrong key or a damaged first page. It is classed deterministic because the key comes from the same envelope that step 6 used to create and verify `S_db`, so a 26 here means damage. If it were a key change, rollback would still keep `P_db` intact; the restored copy is discarded and the backup file still exists.
- **A permanent error classed as transient** (persistent EIO, a 14 from a permission problem) leaves the app at `RESTORE_VERIFY_RETRY` until the cause goes away. §2 gives the user a way back to the previous data.
- **A missing `L_db`** can't reach the verifier: the `verifying` row requires `L_db` to be a regular file (§3). If it disappears between probe and open, the open fails with 14 (transient); the next probe no longer matches a row and the result is `RESTORE_STATE_UNKNOWN`. A missing database is never rolled back as "corrupt".

## 1.4 Reference schema (L6, amends Annex B §B.6)

For **restored and staged** databases (Step 3 step 6, and §1 here), the reference is built at run time, in memory, by the running build's `runMigrations` limited to migrations with `version ≤ 3` (`BACKUP_SCHEMA_VERSION`), and `user_version` must be exactly 3. Backup creation and Check keep v2.4 §B.6 unchanged as long as the build's latest schema is 3; when a later build adds migration 4, the same "≤ 3" reference applies to backup artifacts too (backups stay schema v3 until a separate specification changes the backup format).

Consequence: if the app is updated between the interruption and the recovery, the restored v3 database is still verified against v3; the normal open after recovery then migrates it with the existing snapshot procedure. Verification never accepts a database because a newer build migrated it: no migration runs before verification has passed (§1.1).

## 1.5 Attachment id set

Native code lists `L_att` (the restored root) during `verifying`:
- every entry MUST be a regular file named `<id>.tza` with `id` matching the attachment id pattern (Annex A §A.7);
- any other entry (directory, `kept-ids`, `tmp/`, another name) is **`RESTORE_STATE_UNKNOWN`** — such an entry can only come from an actor that should not exist under the gate (§12, §5), so it is treated as an unexplained state, not as a damaged restore (see open decision D1 in `14-unresolved-v2.5.md`);
- a listing error is transient (`RESTORE_VERIFY_RETRY`).
The set of ids is compared with the database; a difference is deterministic (§1.3).

---

# 2. Cancel restore and return to previous data (M4)

## 2.1 Availability

Offered **only** when all of these hold, re-checked natively at the moment of the action (not only when the screen was drawn):
1. the journal parses and `phase = verifying`;
2. the probe (§3, including its syncs) matches the `verifying` row of the table for the journal's `hadAttachments` exactly, with no sidecar and no unexpected type;
3. the last recovery outcome in this process was `RESTORE_VERIFY_RETRY` (never offered for `RESTORE_UNAVAILABLE`, `RESTORE_STATE_UNKNOWN`, `RESTORE_RECOVERY_RETRY` or `RESTORE_IN_PROGRESS`);
4. the previous data is structurally valid: `P_db` is a regular file whose size is > 0 and a multiple of 4096; if `hadAttachments = true`, `P_att` is a directory that can be listed. (Structural only: opening `P_db` would need the key the transient failure may concern.)

## 2.2 Effect

1. The UI asks for explicit confirmation: "The restored data will be discarded and Trezor returns to the data you had before the restore." Cancelling the dialog changes nothing.
2. Native code, holding the lock (§5): re-checks §2.1, then writes `phase = rollingback` durably (§4.2).
3. Nothing else happens in that call. The app then runs recovery as for Retry; the `rollingback` rows (v2.4 §8.5) roll back, then `rolledback` restores the schedule and deletes `S_att`, `S_db`, `D/restore`, `N/quarantine/<restoreId>`, then the journal.

Previous data is never deleted on this path: rollback only renames it back. The restored data is deleted only in `rolledback`, after `L_db`/`L_att` are the previous ones again. If any action fails, the journal stays and the next attempt continues the rollback (v2.4 M-d: never forward again).

## 2.3 UI

The action appears on the existing storage-error screen only for `RESTORE_VERIFY_RETRY`, as a secondary action below Retry, with the confirmation dialog of the existing `Dialog` component. Retry stays the primary action. (This is the only UI Step 4 adds; see §10 and D2.)

---

# 3. Typed file-state probe (M5, L4, L5)

## 3.1 Path states

Every path is classified with `lstat` (`android.system.Os.lstat`), never `File.exists()`:

| Result | Meaning |
|---|---|
| `FILE` | regular file |
| `DIR` | directory |
| `ABSENT` | `lstat` failed with `ENOENT` (and only then) |
| `OTHER` | any other type, a symlink included |
| `ERROR` | `lstat` failed with any other errno |

Expected types: `L_db`, `S_db`, `P_db`, the journal → `FILE`; `L_att`, `S_att`, `P_att`, `D/restore`, `N/restore`, `N/quarantine/<restoreId>` → `DIR`.

- Any `ERROR` → stop, act on nothing: `RESTORE_RECOVERY_RETRY`.
- A present path of the wrong type, or `OTHER` → `RESTORE_STATE_UNKNOWN`, act on nothing.
- "Present" in the v2.4 tables means the expected type; `ABSENT` means absent.

## 3.2 Inputs of the decision

`journal` (absent / parsed / unparseable), `phase`, `hadAttachments`, `scheduleSaved`, `A = (L_att, S_att, P_att)`, `B = (L_db, S_db, P_db)`, the sidecars of §3.3, the temp files of §3.5. The decision is a pure function of these inputs and returns exactly one row action or `RESTORE_STATE_UNKNOWN`.

## 3.3 Sidecar files (L4)

For each `X` in `L_db`, `S_db`, `P_db`: `X-journal`, `X-wal`, `X-shm`.
- In phases `swapping`, `verifying`, `cleanup`, `rollingback`, `rolledback`: any sidecar present (any type) → `RESTORE_STATE_UNKNOWN`.
- In `prepared` and the "none" row: sidecars beside `S_db`/`P_db` are deleted with `D/restore`; sidecars beside `L_db` are left alone (the live database is not touched; its normal open handles a hot journal).
- In the restoring process: step 13 requires no sidecar beside `L_db`; step 13a requires none beside `L_db` and `S_db` (§6).
- The app never enables WAL; a `-wal` or `-shm` anywhere means an unexplained writer.

## 3.4 `scheduleSaved` (L5)

`scheduleSaved = pending` is allowed only in `prepared` (and is not stored in "none"). In `swapping`, `verifying`, `cleanup`, `rollingback`, `rolledback` it is `RESTORE_STATE_UNKNOWN` (step 13 is reached only after step 10–11 recorded `saved` or `absent`).

## 3.5 Temp files

- `N/restore/restore.json.tmp` is never read; it is deleted (and `N/restore` synced) before the journal is read.
- `N/restore/incoming-attachment.tmp`: deleted in `prepared` and "none" with the staging; present in any later phase → `RESTORE_STATE_UNKNOWN`.
- `N/restore/schedule.saved.bin.tmp` and `N/reminders/schedule.bin.tmp`: handled by `restoreAndRearm` (§9) in `prepared` and `rolledback`; in other phases ignored.

## 3.6 Renames use the probe

Before each rename, the target is probed and must be `ABSENT`; the source must be the expected type. The rename itself (`File.renameTo` replaces on POSIX) is no-replace only by this check under the lock (§5) in a single process; the residual check-to-rename window is accepted (no other actor can run, §5, §12).

---

# 4. Directory durability (M1)

## 4.1 The sync set

The **sync set** is the directories whose entries the state machine depends on, each synced only if it exists (`DIR`): `D`, `D/restore`, `N`, `N/restore`. Syncing a directory makes its current entries durable (with the assumption of §11).

## 4.2 When to sync

| Moment | What is synced | On failure |
|---|---|---|
| **Before classifying** (every probe of §3) | the journal file (if `FILE`), then the sync set | stop, act on nothing: `RESTORE_RECOVERY_RETRY` |
| **Every journal write** | temp file `fsync`, rename over `restore.json`, `fsync N/restore` (v2.4 §8.4) — preceded by a sync of the sync set | the previous phase stays authoritative; stop: `RESTORE_RECOVERY_RETRY` (restoring process: restart, §6) |
| **Every rename** (a–d, r1–r4, Cancel's none) | source parent, then destination parent (`renameNoReplaceDurable`) | see §4.3 |
| **Every deletion** (cleanup, rolledback, prepared, none) | the deleted entry's parent | stop: `RESTORE_RECOVERY_RETRY` |
| **Journal deletion** (last action of a row) | `fsync N/restore`; then removal of an empty `N/restore` (§8) and `fsync N` | stop: `RESTORE_RECOVERY_RETRY` |

## 4.3 A failed sync after a successful rename

A sync failure after `renameTo` returned success MUST NOT be read as "the rename didn't happen". The operation stops with `RESTORE_RECOVERY_RETRY` (startup) or a restart (restoring process). The next attempt re-probes **with the syncs of §4.2 first**, so it classifies the state the filesystem shows and makes it durable before acting on it. Every row is defined for either outcome of a single rename (v2.4 §8.5), so both outcomes are handled.

The same applies to a failed journal sync: the next probe reads whichever phase is visible, after syncing it.

---

# 5. Restore lock (H1, L7)

## 5.1 The lock

A process-wide native lock (a single object in the restore package) has three states: `IDLE`, `PREPARING(sessionId)`, `RECOVERING`.

| Operation | Requires | Sets |
|---|---|---|
| `beginRestore` (Step 3 step 1) | `IDLE`, `RestoreGate` not held | `PREPARING` |
| every native restore step of a session | `PREPARING(own id)` | — |
| session ends (pre-swap cleanup succeeded, or restart) | — | `IDLE` (restart: process ends) |
| `recoveryBegin` (§7) | `IDLE`, `RestoreGate` not held | `RECOVERING` |
| `recoveryEnd` | `RECOVERING` | `IDLE` |
| Cancel restore (§2) | `IDLE` or `RECOVERING` (own) | — |

A request that finds another state is refused with **`RESTORE_IN_PROGRESS`** and changes nothing. Every native step runs while the state is held, on the restore module's single worker lane.

## 5.2 JS side

- `prepareRestore` registers its run in `openStorage`'s module state for its whole duration (also when started from the error screen without a live database).
- `openStorage`, finding a registered restore, waits for it to settle and then starts `initialize` (recovery included). A new React root or a recreated Activity therefore never runs recovery while a restore of the same JS runtime is active.
- If the JS runtime is replaced (reload, host teardown, §13), its registration is lost; the native lock still refuses recovery until the old session has ended (§5.3).

## 5.3 Module invalidation (L7)

`TrezorRestoreModule.invalidate` must not end the session while a native step is running: it waits for the step on the restore worker lane to return (the lane's shutdown already lets accepted work finish), then releases the session (`PREPARING → IDLE`) and the attachment gate. Files and journal stay; the next `initialize` runs recovery on them. Recovery can't start before that release (`RESTORE_IN_PROGRESS`, which the startup error screen shows with Retry).

---

# 6. Restoring process: §8.2 steps 13–16 (L1)

Runs inside the database gate's callback (v2.4 §5), immediately after Step 3's step 12, while the session holds the lock.

1. **Step 13.** After the owner's last statement, JS closes the live connection with `SerialDatabase.close()` (direct, not queued; it interrupts and drains op-sqlite's own worker, `serialDatabase.ts:51`). Work queued behind the gate is never run: it fails on the closed connection, and the process ends at step 16. JS then asks native to confirm no sidecar beside `L_db` (§3.3); otherwise the failure path of 6.6.
2. **Step 13a.** Native, under the lock: probe (§3, with §4 syncs) must match the `prepared` row exactly: `L_db` `FILE`, `S_db` `FILE`, `S_att` `DIR`, `P_db` and `P_att` `ABSENT`, `L_att` `DIR` iff `hadAttachments`, no sidecar beside `L_db` or `S_db`, `scheduleSaved` ∈ {`saved`, `absent`}, no `incoming-attachment.tmp`. Otherwise 6.6.
3. **Step 14.** Write `phase = swapping` (§4.2). Renames a (skipped if `hadAttachments = false`), b, c, d, each with §3.6 and §4.2.
   - A rename that fails, or whose sync fails: write `phase = rollingback` (§4.2), then run the rollback rows **with the same native runner recovery uses** (§7): r1…r4 as the files show, then `rolledback` (schedule restored, staging and this quarantine deleted, journal deleted). Then 6.5 (restart): the live connection is closed, so the old UI can't continue.
   - If writing `rollingback` fails: 6.5 (restart); recovery continues from `swapping`.
4. **Step 15.** Write `phase = verifying` (§4.2). On failure: 6.5; recovery continues from `swapping` (after d it writes `verifying` itself).
5. **Step 16 / restart.** JS calls `restartProcess` and then awaits a promise that **never settles**. After the call JS MUST NOT release any gate (reconcile, database, native), resolve the restore, return to the old UI, or run any other operation. Native: `ProcessRestart.restart` relaunches only from a RESUMED `MainActivity` (v2.4 §8.10, L8), then `finishAffinity` and `killProcess`, unconditionally. If the process somehow survives, it stays on the restore screen; nothing returns to the old UI.
6. **Failure path from step 13 on.** Every exception after step 13 began, in JS or native, ends in 6.5. The journal stays at whatever phase is durable; recovery decides at the next start. The pre-swap failure path of Step 3 is used only before step 13.

---

# 7. Startup recovery (OQ3, v2.4 §8.5)

## 7.1 Position

Recovery is the **first** action of `openStorage`'s `initialize` (`src/storage/openStorage.ts`), before `openTrezorDatabase`, migrations, snapshots, `keepUnreferenced`, attachment garbage collection, and therefore before any React provider mounts (`RemindersProvider` mounts only inside the ready app) and before any reconcile or JS scheduling. A JS runtime reload loses `openStorage`'s module state, so `initialize` and recovery run again before anything else (§5.2 covers an active restore). Native receivers that act without JS (`ReminderAlarmReceiver`, `ReminderRestoreReceiver`) only touch `schedule.bin` under the `ScheduleStore` monitor and are unaffected (v2.4 §8.11, U7).

## 7.2 Procedure

1. `recoveryBegin` (native): take the lock as `RECOVERING` (§5); else `RESTORE_IN_PROGRESS`.
2. Loop:
   1. `recoveryProbe` (native): delete `restore.json.tmp`, sync (§4.2), read the journal, probe (§3), decide. Returns `NONE` (no journal, no staging), a row action, `VERIFY`, or an error code.
   2. `NONE` → leave the loop.
   3. `VERIFY` → JS verifier (§1); then `finishVerification(outcome)` (native): pass → write `cleanup`; deterministic → write `rollingback`; transient → `RESTORE_VERIFY_RETRY`; key → `RESTORE_UNAVAILABLE`. Codes end the loop.
   4. Any other row → `recoveryStep(row)` (native): performs the row's actions in v2.4 order with §3.6 and §4.2, including its final phase write or journal deletion. A failing action: `RESTORE_RECOVERY_RETRY`, loop ends.
   5. Repeat from 2.1 (each step changes the state; the loop ends within one pass per phase).
3. `recoveryEnd` (native): release the lock (always, also after an error).
4. Only after `NONE`: continue `initialize` as today. Any error code: `initialize` rejects with a `StorageError` carrying it (§10); Retry re-runs `initialize` (F9), i.e. recovery from the start. Every action is idempotent.

## 7.3 Rows (v2.4 §8.5, unchanged) with the v2.5 checks

- **none + staging**: M-c guard (v2.4) with typed probe; then delete `D/restore`, `N/restore` (§4.2); never `N/quarantine`.
- **prepared**: pre-swap failure: `restoreAndRearm` by `scheduleSaved` (§9), delete `D/restore`, `N/restore/attachments`, `incoming-attachment.tmp`, `N/quarantine/<restoreId>`, then the journal, then the empty `N/restore` (§8).
- **swapping**, **rollingback**: the renames still due, as the files show; then the next phase write. A failed roll-forward rename: write `rollingback` (v2.4 M-d); if that write fails, stop (the next attempt starts again from `swapping`).
- **verifying**: §1, §2.
- **cleanup**, **rolledback**: §8.
- Everything else, and every §3 condition: `RESTORE_STATE_UNKNOWN`, nothing touched.

---

# 8. Cleanup and rolledback (M3, L3)

**cleanup** (only after `finishVerification` wrote `cleanup`, i.e. after verification passed; this durable write is the point of no return):
1. delete `P_att` (`N/restore/previous-attachments`), sync `N/restore`;
2. delete `P_db`, `schedule.saved.bin`, then `D/restore` (sync `D`), `N/restore/attachments` (normally absent), syncing each parent;
3. delete the journal (§4.2);
4. if `N/restore` is now empty, delete it and sync `N`.

**rolledback**: `restoreAndRearm` (§9); delete `S_att`, `S_db`, `D/restore`, `N/quarantine/<restoreId>` (syncing parents); delete the journal; remove an empty `N/restore` and sync `N`.

**Deletion permissions** (`RestoreFileOps.deleteRecursively`): v2.4 §9.3's list plus **`P_att`**, which is deletable only by the `cleanup` row while the journal's phase is `cleanup`. The quarantine of the journal's `restoreId` is deletable only by `prepared` and `rolledback`. No other path is added; quarantine of other restores, the quarantine root, `L_db`, `L_att`, `D`, `N` stay refused.

A journal whose deletion did not become durable is either still visible (its row runs again; every action is idempotent) or gone (the "none" row; after cleanup the M-c guard finds no `P_db`, `P_att` or `schedule.saved.bin` and only staging is deleted). No special handling is needed.

---

# 9. Schedule restore order (normative; v2.4 §8.11 amended)

`restoreAndRearmSchedule`, one critical section on the `ScheduleStore` monitor:
1. by `scheduleSaved`: `saved` and the file present → copy back durably (temp, `fsync`, rename, `fsync N/reminders`); `saved` and absent → skip; `absent` → delete `schedule.bin` if present and sync; `pending` → leave it;
2. delete a stray `schedule.saved.bin.tmp` and `schedule.saved.bin`; for `saved` **always** sync `N/restore`, also when the file was already absent;
3. `rearmAll`.

A failed copy-back keeps the saved copy and arms nothing; a failed deletion or sync arms nothing; a failed re-arm leaves no saved copy, so a retry only syncs and re-arms and never copies an older schedule over what an alarm recorded in between. (Shipped in `86fb3d5`, `f518f79`.)

---

# 10. Error codes and basic recovery UI (OQ2, L2)

Startup recovery codes are added to `StorageErrorCode` and its known set (`src/storage/errors.ts`), so the existing storage-error screen shows them instead of `UNKNOWN`: `RESTORE_STATE_UNKNOWN`, `RESTORE_RECOVERY_RETRY`, `RESTORE_VERIFY_RETRY`, `RESTORE_UNAVAILABLE`, `RESTORE_IN_PROGRESS`.

The screen stays Retry-only, never offers Clear storage, and adds only the Cancel restore action of §2 for `RESTORE_VERIFY_RETRY`. Step 5 owns progress screens, wording, the "Restoring…" screen and the U1 terminal fallback ("Restore isn't finished yet. Close and reopen Trezor to complete it.").

---

# 11. Filesystem assumption A6 (M6, restated)

**Assumed (not proven by any test in this project):** on the app's filesystems (ext4, f2fs), a `rename(2)` within one filesystem, including between two directories of that filesystem, is atomic with respect to crashes: after a crash the entry is at the source or at the target, never both or neither. Once both the source and the destination directory have been `fsync`ed after the rename, its outcome survives power loss.

**Guaranteed by the design, given A6:** every rename is within `D` or within `N` (v2.4 §2); every state reachable through single renames, with or without the syncs, is a row (v2.4 §8.5); the probe syncs before acting (§4), so recovery never builds on a state that isn't durable.

**Not established and needing device evidence:** f2fs behaviour on the reference device for cross-directory renames when one parent is synced and the other not (a removal durable without the new entry would orphan the file); power-loss behaviour at all. JVM and Jest tests prove order and idempotence; emulator process-kill tests show behaviour under process death, not power loss. No document may claim f2fs crash durability without evidence.

---

# 12. Prerequisites (M2)

Before any Step 4 code, as separate reviewed commits:
1. **Attachment gate re-check:** every attachments-module task accepted from JS re-checks `RestoreGate` inside its serialized lane (WORKER or RENDERER) before doing anything, and rejects with `RESTORE_IN_PROGRESS` if held; the check before enqueueing stays. Then a task that passed the outer check before `RestoreGate.begin` and runs after the drain marker can't create files under the gate.
2. **Error codes** of §10 in `errors.ts` (without the UI action), so recovery errors are visible from the first Step 4 commit.

---

# 13. Debug and release (L7)

All rules apply identically to debug and release builds. A JS runtime reload exists in practice only in debug builds; a host teardown of the React instance with the process alive is possible in both. §5 covers both. Tests: JVM and Jest are build-independent; on-device tests (process kills, restart) run on a **release** QA build on a dedicated AVD, because debug builds do not start on the available emulators (Metro debug path). A test that only ran on a debug build does not count as release evidence.
