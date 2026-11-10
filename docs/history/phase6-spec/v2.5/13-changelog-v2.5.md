# Phase 6 spec v2.5 — Change summary and mapping to findings

Sources: Step 4 independent review (findings H1, H2, M1–M6, L1–L7) and the product-owner decisions OQ1–OQ3, M4 (2026-11-10). Section numbers refer to `10-phase6-spec-v2.5.md` unless prefixed "v2.4".

| Finding / decision | Requirement in v2.5 | Section | Conflict with v2.4? |
|---|---|---|---|
| **H1** recovery concurrent with an active restore | Process-wide native restore lock (`IDLE`/`PREPARING`/`RECOVERING`); recovery and begin refuse with `RESTORE_IN_PROGRESS`; JS `openStorage` waits for a registered `prepareRestore`; staging owned by an active session is never deleted | §5.1, §5.2 | Adds a rule v2.4 lacks (§0.2 item 8); new startup code (item 7) |
| **H2** verification failures all become rollback | Dedicated verifier; `verifyArtifact` not reused unchanged | §1.1 | No (v2.4 says "deterministic" without defining it) |
| **OQ1** error classification | Table: 26/11/check failures → rollback; 5,6,7,8,9,10,13,14,21, no code, unknown → `RESTORE_VERIFY_RETRY`; key errors → `RESTORE_UNAVAILABLE`; no `createKey`; no `openTrezorDatabase` before verification; code-26 ambiguity documented | §1.2, §1.3 | No (definition of v2.4 terms) |
| **OQ2** codes vs UI | `RESTORE_*` codes in `errors.ts` in Step 4; Retry-only screen; Step 5 owns progress, wording, U1 | §10, §12 item 2 | No |
| **OQ3** recovery position | First in `openStorage.initialize`; before open, migrations, providers, reconcile, scheduling; Jest ordering test incl. reload; `f518f79` behaviour kept | §7.1, §9 | No |
| **M1** directory sync | Sync set `D`, `D/restore`, `N`, `N/restore` + journal file before classifying and before every phase write; both parents after rename; parent after deletion; failure → `RESTORE_RECOVERY_RETRY`/restart; failed sync never read as "rename didn't happen" | §4 | No (makes v2.4 §8.4/§8.5 precise) |
| **M2** attachment gate race | Prerequisite commit: re-check `RestoreGate` inside the serialized lane | §12 item 1 | No |
| **M3** `P_att` deletion | `P_att` added to the deletion allowlist, only for `cleanup` | §8 | Extends v2.4 §9.3 list by one path, as v2.4 §8.5 cleanup row already requires |
| **M4** cancel restore | Secondary action in `verifying` after `RESTORE_VERIFY_RETRY`; structural validity of `P_db`/`P_att`; confirmation; durable `rollingback`; existing rollback rows; never in unknown/ambiguous states; Retry stays | §2 | **Yes**: new user-initiated `verifying → rollingback` transition (§0.2 item 1); UI placement vs OQ2 (open decision D2) |
| **M5** type-aware checks | `lstat` probe: FILE/DIR/ABSENT(ENOENT only)/OTHER/ERROR; wrong type or OTHER → `RESTORE_STATE_UNKNOWN`; ERROR → `RESTORE_RECOVERY_RETRY`; target ABSENT before each rename | §3.1, §3.6 | Refines v2.4 "every other combination" (§0.2 item 2) |
| **M6** A6 assumption | Restated: what is assumed, what is guaranteed given A6, what needs device evidence; no f2fs claim | §11 | No |
| **L1** after `restartProcess` | JS awaits a never-settling promise; no gate release, no UI return | §6.5 | Adds a rule (§0.2 item 6) |
| **L2** (Step 3) codes visible | Covered by §10 | §10 | No |
| **L3** empty `N/restore` | Removed after cleanup and rolledback, `N` synced | §8 | No |
| **L4** sidecars | `-journal`/`-wal`/`-shm` beside `L_db`, `S_db`, `P_db`; invalid from `swapping` on; rules for prepared/none/13/13a | §3.3 | **Stricter** than v2.4 §8.2 step 13 (only `-journal` of `L_db`) (§0.2 item 3) |
| **L5** `pending` in late phases | `RESTORE_STATE_UNKNOWN` outside `prepared` | §3.4 | No |
| **L6** app upgrade before recovery | Reference = migrations ≤ 3, `user_version` = 3; no migration before verification | §1.4 | **Yes**: amends Annex B §B.6 (§0.2 item 5) |
| **L7** debug/release | Same rules; reload/teardown covered by §5; device tests on release QA | §5.3, §13 | No |
| Step 3 clarification | Schedule order copy-back → delete+sync → re-arm made normative | §9 | **Yes**: amends v2.4 §8.11 order (§0.2 item 4), already approved in Step 3 review |

## Notes

- **Step 3 memory item "prepared recovery must inspect the actual schedule":** resolved by OQ3 + H1 rather than by new logic. Recovery runs before any provider mounts, and the lock keeps it from running while a session still exists, so no reconcile can rebuild `schedule.bin` between the session's end and the `prepared` recovery. Native receivers only re-arm from the (cleared) schedule. Copy-back for `saved` therefore stays as in v2.4. A test covers it (T-J5).
- No change to TZBK/TZA formats, cryptographic parameters, Replace-only restore, quarantine isolation, or the no-overwrite principle.
- No row of the v2.4 §8.5 tables is removed or rewritten.

## Decisions applied and implementation clarifications (Step 4 implementation, 2026-11-10)

Decisions D1–D3 as proposed. D4 approved as a stronger check than the draft's §2.1 condition 4: before Cancel restore is offered (and again when it is confirmed), `P_db` is opened read-only with the device key and must pass `cipher_integrity_check`, `integrity_check` and the schema of its own `user_version` (1 to the build's latest, nothing migrated), and every attachment row must have its file in `P_att`. The structural check (non-empty, whole 4 KiB pages; `P_att` listable) stays natively. D5–D7 as proposed.

Clarifications, no change to the state machine:
- §6 step 13's "no sidecar beside `L_db`" is checked natively within 13a.
- §5.2: `openStorage` also resumes a pending pre-swap cleanup of the same runtime before recovery (`settleRestore`); otherwise its session would keep the lock and Retry would show `RESTORE_IN_PROGRESS` until the app restarted.
- §1.5: an `lstat` error on an entry of `L_att` during `verifying` is transient (`RESTORE_VERIFY_RETRY`), like a listing error.
- The Step 3 concern about `prepared` recovery copying an old `schedule.saved.bin` over a schedule rebuilt after a JS reload doesn't arise (lock + recovery-first, see Notes above); the copy-back stays as in §9.
- Recorded in the repository in `docs/TECHNICAL_ARCHITECTURE.md` §8.7.1.
