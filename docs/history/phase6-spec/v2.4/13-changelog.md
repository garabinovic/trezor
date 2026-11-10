# Phase 6 — Change log (v2.4, includes v2.3)

## v2.4 — documentation-only revision after the final review of v2.3

No change to the TZBK v1 or TZA v1 format, the cryptographic parameters, or earlier architectural decisions. No finding required a format change. "Spec" = `10-phase6-spec-v2.4.md`.

| Finding | Resolution | Where | Test |
|---|---|---|---|
| **H1** Zero-attachment restore could strand the app | `S_att` is always created (empty if n = 0); new step 13a checks the exact `prepared` state before `swapping`; any deviation is a pre-swap failure | Spec §8.2 steps 4, 13a; §8.5 | 35, 36 |
| **M-a** Schedule restore not idempotent | `saved` with the file already absent means the copy-back completed: skip to `rearmAll`; the file is deleted only after `rearmAll`; failures keep the journal | Spec §8.11 | 37 |
| **M-b** Receivers could race the schedule copy, clear or restore | `saveAndClearSchedule` and `restoreAndRearmSchedule` each hold the `ScheduleStore` monitor for their whole duration, so `onFire`/`rearmAll` wait (decision 5); lock order stated | Spec §5, §8.2 step 10–11, §8.11 | 38 |
| **M-c** "No journal" row deleted unconditionally | `P_db`, `P_att` or `schedule.saved.bin` without a journal → `RESTORE_STATE_UNKNOWN`, nothing deleted; quarantine never touched | Spec §8.5 | 39 |
| **M-d** Failures during swap and recovery undefined | Every failed recovery action keeps the journal and files and shows `RESTORE_RECOVERY_RETRY`; a failed roll-forward rename switches to `rollingback`; rollback never switches forward; a missing key in `verifying` → `RESTORE_UNAVAILABLE` with everything kept; "derives it" removed | Spec §8.2 step 14, §8.5 | 40 |
| **M-e** One bad attachment blocks every backup | The backup fails with `BACKUP_ATTACHMENT_UNREADABLE` naming the attachment id, `item_id` and reason; never omitted silently (decision 2) | Spec §6.2 step 5 | 41 |
| **L1** Schema check depends on the SQLite version | Limit stated; a cross-version vector (or a reviewed normalization rule) required before any op-sqlite/SQLite upgrade | Annex B §B.6 | 44 (format), upgrade gate |
| **L2** Pragma checks prove the connection, not the file; `temp_store` redundant | Stated what the check proves and how file differences fail closed; `SQLITE_TEMP_STORE=3` noted; memory cost documented | Annex B §B.2 | 19 |
| **L3** Database access under the gates | Gate owner runs live statements through the gate callback; native steps never use the live connection; separate connections for other databases; restore's queued work never runs after step 13 | Spec §5, §6.2 step 4, §8.2 steps 6, 13, §8.7 | 42 |
| **L4** Startup cleanup gaps | `D/check/*` cleaned at startup; a pending-destination record lets the next start delete a partial SAF file, with a one-time notice if it can't | Spec §6.4 | 43 |
| **L5** Manifest and header ambiguities | Invalid UTF-8 and escaped lone surrogates rejected; lengths in code points; the canonical writer escapes only U+0000–U+001F (DEL and C1 raw); the 4 GiB sum is inclusive; header error precedence fixed; section and trailer vectors take the artifact bytes as a fixed input | Spec §3.1, §3.8; Annex B §B.3 | 44 |
| **L6** Wording | The database tuple renamed `B`; §6.2 step 7 fixed; `hadDatabase` always `true` (and `false` is unknown); `WRITE_FAILED`, `KEY_ALREADY_EXISTS`, `INVALID_ARGUMENT` mapped to Retry; the fallback text says the restore isn't finished | Spec §6.2, §8.1, §8.4, §8.5, §8.10 | 45 |
| **L7** Quarantine growth; damaged `kept-ids` | No automatic cleanup (decision 6), documented; damaged/unreadable `kept-ids` → every `.tza` in the root retained (fail closed, preserves user files); an id without a file is skipped and counted | Spec §9.2; Annex A §A.7 | 46 |
| **L8** Lifecycle | The foreground test defined (the activity's `Lifecycle` ≥ `RESUMED`, no new dependency); no foreground service in v2.4 (decision), keep-open message; shown notifications not re-posted after a rollback (accepted) | Spec §8.10, §8.11 | 47 |

**Decisions applied:** 1–3 as stated; 4 (the backup gate is held through the complete attachment section, no early release), 5 (shared native `ScheduleStore` lock), 6 (no automatic quarantine cleanup; fail closed on a damaged `kept-ids`), 7 (no format change).

**Also corrected while editing:** the error-screen restore precondition 5. `DATABASE_UNREADABLE` can also come from a failed *create* (`src/storage/database.ts:90-93`), so without a database file no restore entry is offered.

---

## v2.3

Maps every finding of the independent review of v2 + v2.1 + v2.2 to its resolution in v2.3. "Spec" = `10-phase6-spec-v2.3.md`, "A" = Annex A, "B" = Annex B.

## Format blockers

| Finding | Resolution | Where |
|---|---|---|
| **B1** The nonce prefix was said to come "from the section framing" | The nonce prefix is header bytes 55–61, the same for all sections; uniqueness comes from the per-section key | Spec §3.1, §3.6 |
| **B2** No numeric KDF or cipher identifiers | KDF `0x01` = Argon2id v0x13; cipher suite `0x01` = AES-256-GCM + HKDF-SHA256 + HMAC-SHA256; anything else rejected before Argon2 | Spec §3.1 |
| **B3** TZA v1 not normative; no id/path rule | New normative Annex A from `AttachmentFormat.kt` (header, wrap AAD, body AAD, nonce, chunking, rewrap, `tzaSize`, chunk size 65536 in backups); id pattern checked before any path; the attachment section is the complete rewrapped TZA file | A; Spec §3.10 |
| **B4** SQLCipher artifact parameters not pinned; vectors impossible | New normative Annex B: SQLCipher 4.19.0 defaults pinned from `sqlite3.c`, checked by pragma on every connection; the schema check against the app's own runtime reference; complete-backup vectors are verification vectors | B; Spec §3.9 |
| Manifest schema deferred (review note) | Defined in full now (manifest version 1): fields, types, ranges, order, strict parsing, canonical writer | Spec §3.8 |

## Major

| Finding | Resolution | Where |
|---|---|---|
| **M1** The reminder floor is useless and harmful | `noArmBefore` removed entirely. Reason from the code: past occurrences are armed only through `armedFor`, cleared by `sync([])`; otherwise only the first occurrence after now, for every type. Test 25 proves no old occurrence fires, ONCE or recurring | Spec §8.11, §13 (25) |
| **M2** Clearing alarms loses state on failure | `completeFired` on the live DB first (step 9); the encrypted schedule is copied byte for byte with a journal state `pending/saved/absent` (step 10); pre-swap failure and `rolledback` copy it back and call `rearmAll` (keeps pending ONCE and `fired`); success deletes it. Test 24 | Spec §8.2, §8.4, §8.11 |
| **M3** The SQLCipher key exception was too narrow | Extended to exactly three uses: backup export and verification, Check staging, restore staging and export | Spec §5 |
| **M4** Lifecycle contradiction; no layer split; no matrix | v2 §6.4 steps 8–11 superseded: the restoring process never reopens a database after closing it; the new process verifies. A layer table for every operation; recovery's place in `openStorage`; the complete phase × filesystem-state matrix, with every other state `RESTORE_STATE_UNKNOWN` | Spec §5, §8.2, §8.5 |
| **M5** No restore entry when the live DB is unreadable | Entry from the storage-error screen for four named codes; preconditions (keys, no hot journal); key codes give `RESTORE_UNAVAILABLE` | Spec §8.1 |
| **M6** Password rules could differ between platforms | A fixed UCD 8.0.0 table with checksums; exact allowed General Categories; `Cf` rejected except ZWJ/ZWNJ; variation selectors allowed; a fixed order (raw check → NFC → recheck → limits on the NFC output) | Spec §4 |

## Minor

| Finding | Resolution | Where |
|---|---|---|
| `plaintextLength` and its inverse | `P` is the section total; inverse formula and rejection rules; 64-bit arithmetic | Spec §3.6 |
| Argon2 256 MiB reader vs heap | v1 accepts only `m = 65536`; a heap pre-check; widening needs a new version and device evidence | Spec §3.1 |
| The backup gate must queue writes | An exclusive op on the serialized queue: later work waits and runs in order; native deferral of deletions in the exported set; a blocking progress screen | Spec §6.1 |
| Check → Restore reads twice | The restore pass verifies fully and must match the Check's backup ID and trailer (`BACKUP_CHANGED`) | Spec §8.3 |
| `hasAnyFile` and staging/previous | Covers `L_att`, `S_att`, `P_att`, `N/quarantine/*` (Step 3) | Spec §8.6 |
| Settings outside the allowlist | Deleted from the staged DB; value validation; device-local keys from the live DB or defaults | Spec §8.8, B §B.7 |
| `kept-ids` and `tmp/` in the swap | `S_att` holds only `.tza`; the old root (with `kept-ids`, `tmp/`) goes to `P_att`; retained files linked or copied to quarantine first | Spec §9.2, §8.2 step 7 |
| New `DatabaseFiles` operations | `syncDirectory`, `renameNoReplaceDurable`, `linkOrCopyDurable`, a limited `deleteRecursively`; the prerequisite directory sync for snapshots | Spec §9.3 |
| Old-dataset notifications | `sync([])` plus cancelling every active `reminder:` tag | Spec §8.2 step 11 |
| Manifest ids = DB ids; TZA size | Exact set equality and per-field equality; `tzaSizeBytes = tzaSize(sizeBytes)` | Spec §3.8, §7, A §A.6 |
| Android 14 restart | Foreground-only relaunch; background → terminate, recover at next launch; terminal-screen fallback; device verification required | Spec §8.10 |
| The free-space explanation was wrong | Same partition stated; requirements grouped by `st_dev` and summed | Spec §9.6 |
| Tests | 34 acceptance tests covering every point | Spec §13 |

## Other changes made in v2.3 (decisions for confirmation)

| Change | Reason |
|---|---|
| Manifest limit 4 → **16 MiB** | 20 000 entries with long file names exceed 4 MiB |
| Phases unchanged from v2; the old "first reconcile with grace 0" and the v2.1/v2.2 floor are withdrawn | M1 |
| The restoring process never reopens the DB; verification in the new process | Removes the need for an in-process reopen API (F9 has none) |
| A hot journal (`trezor.db-journal`) refuses an error-screen restore | It can't be moved safely together with an unreadable DB |
| The UI blocks editing during backup creation | Keeps queued writes, which a crash would lose, to background work only |
| Quarantine by hard link, else copy | No extra space normally; the original stays in place until cleanup |
| Error codes added | `BACKUP_UNSUPPORTED`, `BACKUP_CORRUPT`, `BACKUP_PASSWORD_OR_HEADER`, `BACKUP_TOO_LARGE`, `BACKUP_INSUFFICIENT_MEMORY`, `BACKUP_INCONSISTENT`, `BACKUP_CHANGED`, `PASSWORD_*`, `RESTORE_UNAVAILABLE`, `RESTORE_STATE_UNKNOWN`, `RESTORE_VERIFY_RETRY` |

## Withdrawn from earlier versions

- v2 §3.2 HKDF labels `manifest` and `database`.
- v2 reader range for `m`.
- v2 §6.4 steps 8–11.
- v2 §6.9 "grace 0" rules.
- v2.1 §5 and v2.2 §5 (floor).
- v2.1 §9's "gate released on all failure paths".
- v2.2 §3.1 "prefix from the section framing".
- v2.2 §9's justification.
