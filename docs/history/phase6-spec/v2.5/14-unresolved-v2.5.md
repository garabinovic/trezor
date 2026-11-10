# Phase 6 spec v2.5 — Unresolved decisions

Each item has a proposed default, written into the v2.5 draft so Step 4 is implementable as is. Approval of v2.5 approves these defaults unless the product owner changes them.

| # | Question | Proposed default (in the draft) | Alternative | Affects |
|---|---|---|---|---|
| **D1** | An unexpected entry in `L_att` during `verifying` (not `<id>.tza`: a directory, `kept-ids`, `tmp/`) | `RESTORE_STATE_UNKNOWN`, nothing touched (§1.5) | Treat as deterministic → rollback | §1.5 |
| **D2** | M4 adds a UI action in Step 4 although OQ2 gave Step 5 the recovery UI | Minimal secondary action + confirmation on the existing error screen, only for `RESTORE_VERIFY_RETRY` (§2.3) | Native/JS API in Step 4, button in Step 5 (then Step 4 ships with Retry only) | §2.3, §10 |
| **D3** | SQLite 21 (MISUSE) and unknown codes as transient | Transient (§1.3), relying on Cancel restore as the way out | Deterministic → rollback | §1.3 |
| **D4** | "Structurally valid" previous data | `P_db` regular, size > 0 and a multiple of 4096; `P_att` a listable directory when `hadAttachments` (§2.1) | Also open `P_db` with the key (fails exactly when the key is the problem) | §2.1 |
| **D5** | Journals written by Step 3-era builds on dev/QA AVDs (`prepareRestore` always undoes itself, so only a killed preparation leaves one) | Handled by the normal `prepared` row; no migration code | Manual cleanup of test AVDs (with approval) | §7.3 |
| **D6** | Check-to-rename window (§3.6): no `renameat2(RENAME_NOREPLACE)` from Java | Accepted under the lock with a single actor | JNI `renameat2` | §3.6 |
| **D7** | Wording of the Cancel confirmation | Placeholder text in §2.2; final wording in Step 5 | — | §2.2 |
| U1, U6, U7 | Carried over from v2.4 unchanged | — | — | v2.4 |

No decision here changes formats, cryptography or the state tables.
