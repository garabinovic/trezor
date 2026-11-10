# Trezor — Phase 6: Encrypted Backup & Restore
## Technical Specification v2.4 (complete)

**Status:** Proposed — pending independent review and formal approval
**Platform:** Android (format cross-platform)
**Backup format:** TZBK v1 · **Database schema:** v3 · **Restore:** Replace only
**Normative annexes:** Annex A (TZA v1, `11-annex-A-tza-v1.md`), Annex B (SQLCipher and schema, `12-annex-B-sqlcipher-schema.md`)

**Supersedes:** this document replaces v2.3, and through it the v2 specification and the v2.1 and v2.2 annexes, in full. Where any earlier text conflicts with v2.4 or its annexes, v2.4 applies. Decisions from earlier versions that are not repeated here are withdrawn; the change log (`13-changelog.md`) lists every change. v2.4 changes documentation only: the TZBK v1 and TZA v1 formats and all cryptographic parameters are unchanged from v2.3.

**Conventions:** MUST / MUST NOT / SHOULD as in RFC 2119. All integers are unsigned and big-endian unless stated otherwise. `‖` is byte concatenation. `[n]` is a field of n bytes. KiB/MiB/GiB are powers of 1024. Source citations are `path:lines` at commit `7277967`.

---

# 1. Objective and principles

Provide password-protected backup creation, non-destructive checking, and Replace-only restore of all user data, on the same or another installation, recoverable after interruption at any point.

The backup is independent of Android Keystore keys, installation identity, signing certificate and device keys. No cloud service, account, analytics or network access.

Fundamental rules:

1. Active data is never modified by backup creation or Check.
2. Replacement begins only after the complete backup has been validated and staged.
3. The previous data stays recoverable until the restored state has been verified in a new process.
4. Unknown formats, states and cryptographic conditions fail closed.
5. No silent deletion, no destructive fallback.
6. A missing device key is never recreated over data that may depend on it.
7. Large data is processed with bounded streams only.

Excluded: cloud sync, automatic/scheduled/incremental backups, merge, single-item import, password recovery, key-loss recovery, iOS implementation.

---

# 2. Storage layout (Android)

Evidence: the database directory is `Context.getDatabasePath(..).parentFile` (`android/.../storage/TrezorDatabaseFilesModule.kt:12`; op-sqlite uses the same directory, `node_modules/@op-engineering/op-sqlite/android/src/main/java/com/op/sqlite/OPSQLiteModule.kt:31-34`). Keys, attachments and the schedule are in `noBackupFilesDir` (`vault/TrezorVaultModule.kt:18`, `attachments/TrezorAttachmentsModule.kt:45-56`, `reminders/ScheduleStore.kt:57`).

Let `D` = database directory, `N` = `noBackupFilesDir`, `C` = `cacheDir`.

| Path | Contents |
|---|---|
| `D/trezor.db` | Live database, `L_db` |
| `D/trezor.pre-migration-v*.db` | Migration snapshots (unchanged by Phase 6) |
| `D/backup/` | Temporary backup-key export during backup creation |
| `D/check/<checkId>/` | Check staging |
| `D/restore/incoming.db` | Restore: database artifact decrypted from the backup (backup key) |
| `D/restore/trezor.db` | Restore: staged database under the device key, `S_db` |
| `D/restore/previous.db` | Restore: previous live database, `P_db` |
| `N/attachments/` | Live attachment root, `L_att` (`<id>.tza`, `kept-ids`, `tmp/`) |
| `N/restore/restore.json` | Restore journal |
| `N/restore/schedule.saved.bin` | Byte copy of the encrypted schedule before alarms are cleared |
| `N/restore/attachments/` | Staged attachment root, `S_att` |
| `N/restore/previous-attachments/` | Previous attachment root, `P_att` |
| `N/quarantine/<restoreId>/<id>.tza` | Retained (kept) files preserved by a restore |
| `N/reminders/schedule.bin` | Native schedule (not authoritative) |
| `C/attachments/view/`, `C/attachments/share/` | Decrypted view and share copies |

Each rename in §8 stays within one filesystem, from one of these paths to another under the same root (`D` or `N`).

---

# 3. TZBK v1 file format

File extension `.trezorbackup`. Layout:

```
header[128] ‖ section(manifest) ‖ section(database) ‖ section(attachment 0) … section(attachment n-1) ‖ trailer[32]
section = framing[13] ‖ ciphertext[L]
```

## 3.1 Header

| Offset | Size | Field | Value |
|---:|---:|---|---|
| 0 | 4 | Magic | ASCII `TZBK` (`54 5A 42 4B`) |
| 4 | 2 | Version | `0x0001` |
| 6 | 2 | Header length | `0x0080` (128) |
| 8 | 1 | KDF identifier | `0x01` = Argon2id version 0x13 |
| 9 | 1 | Cipher-suite identifier | `0x01` = AES-256-GCM + HKDF-SHA256 + HMAC-SHA256 |
| 10 | 4 | Argon2 memory `m` | KiB |
| 14 | 4 | Argon2 iterations `t` | |
| 18 | 1 | Argon2 parallelism `p` | |
| 19 | 16 | Salt | random |
| 35 | 16 | Backup ID | random |
| 51 | 4 | Chunk size | `65536` |
| 55 | 7 | Nonce prefix | random; shared by all sections (§3.6) |
| 62 | 12 | BMK wrapping IV | random |
| 74 | 48 | Wrapped BMK | AES-GCM ciphertext (32) ‖ tag (16) |
| 122 | 4 | CRC32 | §3.2 |
| 126 | 2 | Reserved | `0x0000` |

Validation order (reader), all before Argon2. The **first** failing check decides the error:

1. Fewer than 128 bytes, or magic ≠ `TZBK` → `BACKUP_CORRUPT` (not a backup).
2. Version ≠ 1 or header length ≠ 128 → `BACKUP_UNSUPPORTED`.
3. CRC (§3.2) → `BACKUP_CORRUPT`.
4. KDF id = `0x01`; cipher id = `0x01`; `m = 65536`; `3 ≤ t ≤ 10`; `p = 1`; chunk size = 65536; reserved = 0 → otherwise `BACKUP_UNSUPPORTED`.

Writers write `m = 65536, t = 3, p = 1`.

**Memory bound (supersedes the v2 reader range 64–256 MiB):** TZBK v1 accepts only `m = 65536` KiB (64 MiB). There is no device evidence that 256 MiB fits the Java heap without `largeHeap`, which Trezor does not set (`android/app/src/main/AndroidManifest.xml`, no `largeHeap`). Before Argon2 runs, the reader MUST check `Runtime.maxMemory() − (totalMemory() − freeMemory()) ≥ 64 MiB + 32 MiB`; otherwise it fails with `BACKUP_INSUFFICIENT_MEMORY` (transient, nothing written). Accepting larger `m` requires a new format version backed by device measurements.

## 3.2 CRC32

CRC-32/ISO-HDLC (reflected polynomial `0xEDB88320`, init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`) over all 128 header bytes with bytes 122–125 set to zero. Stored big-endian at offset 122. CRC detects corruption only.

## 3.3 Password → KEK

Password validation is §4. The validated NFC string is encoded as UTF-8 (no BOM, no terminator). Argon2id, version `0x13`: password = those bytes; salt = header[19..35); `m`, `t`, `p` from the header; secret absent; associated data absent; output 32 bytes = KEK.

## 3.4 Backup Master Key (BMK)

BMK = 32 random bytes per backup. Canonical header = the 128 header bytes with the CRC field (122–125) and the wrapped-BMK field (74–121) set to zero.

`wrappedBMK = AES-256-GCM(key = KEK, iv = header[62..74), aad = canonical header, plaintext = BMK)` → 48 bytes at offset 74.

A failed unwrap means a wrong password or a modified header (`BACKUP_PASSWORD_OR_HEADER`); the two are not distinguished.

## 3.5 Key derivation (HKDF-SHA256)

All keys: HKDF-SHA256 (RFC 5869), IKM = BMK (32), salt = Backup ID (16), output 32 bytes.

| Key | Info (exact bytes) |
|---|---|
| Section key (one per section) | ASCII `TZBK-SECTION-v1` (15 bytes) ‖ type[1] ‖ ordinal[4] |
| Attachment DEK wrapping | ASCII `trezor.backup.v1.attachment-wrap` |
| Trailer HMAC | ASCII `trezor.backup.v1.mac` |
| SQLCipher artifact key | ASCII `trezor.backup.v1.sqlcipher` |

No separator or terminator is added. No label is a prefix of another. There are no other derived keys; the v2 labels `trezor.backup.v1.manifest` and `trezor.backup.v1.database` do not exist.

## 3.6 Sections, framing and chunking

Section types: `0x01` manifest, `0x02` database, `0x03` attachment. Any other type is rejected.

Order: manifest (ordinal 0), database (ordinal 0), then exactly `n` attachment sections with ordinals `0 … n−1`, where `n` is the manifest's attachment count and ordinal `i` is manifest entry `i`.

Framing: `L[8] ‖ type[1] ‖ ordinal[4]`, where `L` is the ciphertext length of the section (all chunks including tags, excluding framing).

Chunking, with chunk size `c` = header value = 65536 and section plaintext length `P` (the total of the whole section):

- `chunkCount = max(1, ⌈P / c⌉)`; every chunk except the last holds exactly `c` bytes; an empty section is one empty chunk.
- `L = P + 16 × chunkCount`.
- **Inverse (reader):** reject `L < 16`. Let `k = ⌈L / (c + 16)⌉` and `P = L − 16k`. Accept only if `k = max(1, ⌈P / c⌉)`; this rejects every `L` whose last chunk would hold fewer than 16 bytes (except `L = 16`), and an empty last chunk after a full chunk. Compute in 64-bit arithmetic and reject overflow.
- Chunk `i` (from 0): `nonce = noncePrefix[7] ‖ i[4] ‖ final[1]`, `noncePrefix` = header bytes 55–61 (the same for all sections), `final` = `0x01` for the last chunk, else `0x00`.
- `AAD = backupId[16] ‖ type[1] ‖ ordinal[4] ‖ c[4] ‖ noncePrefix[7] ‖ P[8] ‖ i[4] ‖ final[1]` (45 bytes).
- Cipher: AES-256-GCM with that section's key, 16-byte tag.

Nonce uniqueness: each `(type, ordinal)` has its own key, and within a section `(i, final)` is unique, so no `(key, nonce)` pair repeats in a file. BMKs are random per backup.

Section plaintext limits (checked on `P` derived from `L` before any read or allocation):

| Section | Maximum `P` |
|---|---|
| Manifest | 16 MiB |
| Database | 256 MiB |
| Attachment | exactly `tzaSize(q)` for the manifest entry's size `q ≤ 25 MiB` (Annex A §A.6) |
| Whole file | 5.25 GiB = 5 637 144 576 bytes |

Every section is read through a stream limited to exactly `L` bytes. A reader never reads past it.

## 3.7 Trailer

`trailer = HMAC-SHA256(key = MAC key, message = header′ ‖ framing₀ ‖ ciphertext₀ ‖ … ‖ framingₖ ‖ ciphertextₖ)` where `header′` is the 128 header bytes with the CRC field zeroed (wrapped BMK included), over all sections in file order. 32 raw bytes, no framing. EOF MUST follow it immediately. Compared in constant time.

Its position follows from the manifest's attachment count and the section lengths. Data from a section is GCM-authenticated as it is read, but everything derived from the file is provisional until the trailer has been verified: no staged result may be marked valid before that.

## 3.8 Manifest (manifest version 1)

UTF-8 JSON (RFC 8259) object, no BOM.

```json
{"format":"trezor-backup-manifest","manifestVersion":1,"createdAt":1793000000000,
 "app":{"platform":"android","versionName":"1.0","versionCode":1},
 "schemaVersion":3,
 "database":{"sizeBytes":131072,"sha256":"<64 lowercase hex>"},
 "attachments":[{"ordinal":0,"id":"<uuid>","fileName":"scan.pdf","mimeType":"application/pdf",
   "sizeBytes":1000,"sha256":"<64 lowercase hex>","formatVersion":1,"tzaSizeBytes":1092}]}
```

| Field | Type | Rule |
|---|---|---|
| `format` | string | exactly `trezor-backup-manifest` |
| `manifestVersion` | integer | exactly `1` |
| `createdAt` | integer | Unix ms, `0 … 2^53−1`; informational |
| `app.platform` | string | `android` or `ios`; informational |
| `app.versionName` | string | 1–64 Unicode code points; informational (`android/app/build.gradle:85-86`) |
| `app.versionCode` | integer | `0 … 2^31−1`; informational |
| `schemaVersion` | integer | exactly `3` |
| `database.sizeBytes` | integer | `1 … 256 MiB`; = database section `P` |
| `database.sha256` | string | SHA-256 of the database artifact, 64 lowercase hex |
| `attachments` | array | `0 … 20 000` entries, sorted by `id` ascending (byte order) |
| `…ordinal` | integer | = array index |
| `…id` | string | Annex A §A.7 pattern; unique |
| `…fileName` | string | non-empty; = DB `attachments.file_name` |
| `…mimeType` | string | one of `src/data/attachments.ts:9-16`; = DB `mime_type` |
| `…sizeBytes` | integer | `0 … 25 MiB` (`src/data/attachments.ts:4`); = DB `size_bytes` |
| `…sha256` | string | 64 lowercase hex; = DB `sha256` |
| `…formatVersion` | integer | exactly `1`; = DB `format_version` |
| `…tzaSizeBytes` | integer | = `tzaSize(sizeBytes)` (Annex A §A.6) |

All fields are required. `null` is not allowed anywhere. Rejected:

- unknown fields, duplicate keys, duplicate ids;
- a sum of `sizeBytes` greater than 4 GiB (the limit is inclusive: exactly 4 GiB is accepted);
- numbers with a fraction, exponent, sign or leading zero, and numbers above `2^53−1`;
- bytes that are not well-formed UTF-8 (anywhere in the manifest);
- a `\u` escape, or a pair of them, that decodes to an unpaired surrogate (U+D800–U+DFFF not forming a valid pair).

String lengths in this table are counted in Unicode code points.

Reader: a strict RFC 8259 parser that rejects duplicate keys. Android's `org.json` is lenient and MUST NOT be used for the manifest. Writer (canonical, for vectors): keys in the order shown above, no whitespace, strings escaped as ECMAScript `JSON.stringify` does: `\"` `\\` `\b` `\f` `\n` `\r` `\t`, the other code points U+0000–U+001F as `\u00XX` with lowercase hex, and **everything else, including U+007F and U+0080–U+009F, as raw UTF-8**. The writer never emits an unpaired surrogate (its input is validated text).

**Manifest limit change:** 16 MiB replaces v2's 4 MiB. 20 000 entries with long file names do not fit in 4 MiB.

## 3.9 Database section

The plaintext is the database artifact (Annex B §B.3): a SQLCipher 4 file encrypted with the SQLCipher artifact key, `P = database.sizeBytes`, `SHA-256 = database.sha256`. No plaintext database is ever written to disk.

## 3.10 Attachment sections

The plaintext of attachment section `i` is the complete TZA v1 file of manifest entry `i` with its DEK rewrapped under the attachment DEK wrapping key (Annex A §A.5). Its length MUST equal `tzaSizeBytes`. The body bytes are the device file's body unchanged.

## 3.11 Error codes (backup file)

`BACKUP_UNSUPPORTED` (version, identifier or parameter), `BACKUP_CORRUPT` (CRC, framing, length, chunk, trailer, manifest), `BACKUP_PASSWORD_OR_HEADER`, `BACKUP_TOO_LARGE`, `BACKUP_INSUFFICIENT_MEMORY`, `BACKUP_INCONSISTENT` (manifest vs database vs attachments).

---

# 4. Backup password

Evidence: no password code exists yet. All validation runs in Kotlin; JavaScript only displays results.

## 4.1 Allowed characters

The allowed set `Σ` is a static table generated from the Unicode Character Database **8.0.0** (`DerivedAge.txt` and `UnicodeData.txt`). The generator, the two source files' SHA-256, and the generated table's SHA-256 are committed with the table. The device's ICU character data is never used for this decision.

A code point is in `Σ` iff its Age is ≤ 8.0 **and** its General_Category is one of:
`Lu Ll Lt Lm Lo Mn Mc Me Nd Nl No Pc Pd Ps Pe Pi Pf Po Sm Sc Sk So Zs`,
**or** it is U+200C (ZWNJ) or U+200D (ZWJ).

Consequences, stated so that implementations agree:

- Rejected: all `Cc`; all `Cf` except U+200C/U+200D (so bidi controls, U+00AD soft hyphen, U+FEFF, U+2060…U+2064, tag characters U+E0020–U+E007F); `Cs` (surrogates); `Co` (private use); `Cn` (unassigned and the 66 noncharacters); `Zl`, `Zp`.
- Allowed: variation selectors U+FE00–U+FE0F and U+E0100–U+E01EF (`Mn`); U+0020 and the other `Zs` spaces; emoji modifiers U+1F3FB–U+1F3FF (Unicode 8.0).

## 4.2 Validation order

For each entered string (UTF-16 from the text field):

1. Every UTF-16 unit sequence is well-formed (no unpaired surrogate), else `PASSWORD_INVALID`.
2. Every code point of the input is in `Σ`, else `PASSWORD_CHARACTER` (with the first offending position).
3. Normalize to NFC (`java.text.Normalizer`, form NFC).
4. Every code point of the NFC result is in `Σ` (defensive; it holds by construction).
5. The NFC result has 10–256 code points and at most 1024 UTF-8 bytes, else `PASSWORD_LENGTH`.
6. On creation: the UTF-8 bytes of both NFC results are identical, else `PASSWORD_MISMATCH`.

No trimming, case folding or other change. NFC is deterministic across platforms for strings in `Σ`: by the Unicode Normalization Stability Policy, NFC of text containing only characters assigned in version V is identical in every later version, and Android 7.0 (`minSdk 24`, `android/build.gradle:4`) ships ICU with Unicode 8.0.

Shared vectors (§13) cover accept, reject and NFC cases.

---

# 5. Responsibilities by layer

SQLCipher is reachable only through op-sqlite in JavaScript (`src/storage/sqlcipher.ts:44-62`); Kotlin has no SQLCipher binding. File, key and crypto work stays native.

| Operation | Layer |
|---|---|
| Password validation, Argon2id, BMK wrap, HKDF, section encryption, HMAC, header/manifest parsing | Kotlin |
| Reading/writing the SAF file, TZA rewrap and verification, quarantine, directory sync, renames, journal, StatFs | Kotlin |
| Exporting, opening, checking and rewriting SQLCipher databases (live, artifact, staging) | JS (op-sqlite) |
| Gate, closing the live connection, settings rewrite, `completeFired` | JS |
| Schedule save+clear and restore+rearm, each as **one** call under the `ScheduleStore` lock (§8.11) | Kotlin |
| Schedule save/clear/restore, notification cancel | Kotlin (`ReminderScheduler`, `ScheduleStore`) |
| Process restart | Kotlin |
| Orchestration of every flow | JS, calling native steps one by one |

**Gate ownership and connections (applies to the backup gate §6.1 and the restore gate §8.7):** a gate is one exclusive operation on the live serialized database (`src/storage/serialDatabase.ts:27-44`). Its callback receives the live connection. Every live-database statement the gate's owner needs runs **through that callback**, never by enqueueing on the serialized queue, which would wait behind the gate itself and deadlock (`serialDatabase.ts:30-34`). Native steps never use the live connection; they have no SQLCipher access. Artifact, staging and reference databases are opened on **separate** connections.

**SQLCipher key boundary (exception, supersedes v2 §11 for this key only):** the SQLCipher artifact key (§3.5) is derived in Kotlin and handed to JS, formatted as `x'<64 lowercase hex>'` and checked by `assertDatabaseKey` (`src/storage/sqlcipher.ts:5-20`), for exactly these operations:

1. Backup creation: `ATTACH … KEY ?` of the export file, and verifying that file.
2. Check: opening the artifact staged in `D/check/<checkId>/`.
3. Restore: opening `D/restore/incoming.db` and exporting it to the device key.

Each handoff serves one operation. The key is never stored in state, settings, files, logs or error messages, is never usable as a device key, and is not available through `KeyVault` or `JsVault`. JS strings cannot be wiped; this is documented like the existing database-key limitation (`src/storage/sqlcipher.ts:35-43`).

---

# 6. Backup creation

## 6.1 Gate

The backup gate is an exclusive operation on the live serialized database (`src/storage/serialDatabase.ts:27-44`): all database work queued before it runs first; work queued after it **waits** (it is not rejected) and runs in order once the gate is released. While the gate is held:

- The UI shows a blocking backup progress screen: no editing, no navigation.
- Background database work (reminder completion, settings writes) queues behind the gate.
- Native file deletion of any attachment id in the exported set is deferred until release. Imports are allowed, because a new file is not in the exported set.
- The gate is held until the last attachment section has been written completely and the output stream is closed; it is not released earlier (decision of v2.4: no early release, no new pinning mechanism). It is also released on any failure or cancellation. Queued work then runs.

If the process dies while the gate is held, queued in-memory writes are lost, as for any crash before a write. The blocking screen keeps this to background writes.

## 6.2 Steps

1. Validate the password (§4); check free space (§9.6) and memory (§3.1).
2. Pick a SAF destination (§6.3).
3. Acquire the gate. Inside one exclusive operation: `ATTACH DATABASE ? AS export KEY ?` with `D/backup/<random>.db` and the artifact key; `SELECT sqlcipher_export('export')`; `PRAGMA export.user_version = 3`; `DETACH DATABASE export`. These four statements MUST NOT be split into separately queued operations, and no transaction is open (ATTACH is not allowed in one). This is the existing snapshot procedure (`src/storage/snapshot.ts:96-125`) with a different key.
4. Open the export file on a **separate** connection (not the live connection or its queue) with the artifact key and verify it per Annex B §B.4. Read the attachment rows **from the export**, not from the live database, together with each row's `item_id`.
5. For each attachment, sorted by id: stream the live `N/attachments/<id>.tza` once, decrypting and authenticating every chunk under the device key while writing the TZA header with the DEK rewrapped under the attachment DEK wrapping key, followed by the unchanged body chunks, into the section (Annex A §A.5). Plaintext size and SHA-256 MUST equal the export's row.

   **A missing or damaged attachment fails the backup (M-e).** If the file is missing, can't be read, fails authentication, or doesn't match its row, the backup stops with `BACKUP_ATTACHMENT_UNREADABLE`. The error carries the attachment id, its `item_id` and the reason (`MISSING`, `DAMAGED`, `MISMATCH`), so the UI can name the item (title from the live state) and the file name. An attachment is **never** omitted silently, and a backup is never produced without it. The ids are shown in the UI only, never logged (§9.4). The user resolves it by opening the item and removing or replacing the file, then backs up again.
6. Write the header, manifest, database section (the export file's bytes), attachment sections and trailer. Close the output. **Release the gate.** Delete `D/backup/<random>.db`.
7. Read back the complete destination file and run the full Check (§7) on it. Success is reported only if it passes.

## 6.3 Destination (SAF)

The destination document MUST report size 0 before writing (an unknown or non-zero size is refused, as Save a copy does). After writing: `fsync` the descriptor where supported, close, check that the size equals the bytes written, then read back (§6.2 step 7). On failure: try to delete the document; if that fails, report that an incomplete file may remain. Cloud or virtual providers that report an unknown size, or cannot be read back, are refused. The UI says a local destination is needed for a verified backup.

## 6.4 Failure

Any failure before success: release the gate if held; DETACH if still attached; delete `D/backup/<random>.db` (encrypted with an ephemeral key); handle the destination as in §6.3; live data unchanged.

**Leftovers after process death (L4):**

- Before writing the destination, Kotlin records its document URI in `N/backup/pending-destination` (the URI only; temp file, `fsync`, rename). The record is deleted just before success is reported, or after the destination has been deleted on failure.
- At startup (before `openStorage` returns, independent of the database):
  - files in `D/backup/` and directories in `D/check/` are deleted: they are encrypted with ephemeral keys and unusable without their BMK;
  - if `N/backup/pending-destination` exists, Kotlin tries to delete that document. Whether or not that works (the URI grant may be gone after process death), the record is deleted. If the deletion failed, the app tells the user once that an incomplete backup file may remain, with its display name if known.

---

# 7. Check backup

Non-destructive: no live file is written. Steps, reading the file once:

1. Header (§3.1–3.2), memory check, Argon2id, BMK unwrap, keys.
2. Manifest section: framing, limits, decryption, strict parse (§3.8).
3. Database section: decrypt into `D/check/<checkId>/incoming.db`; compare size and SHA-256 with the manifest.
4. Attachment sections: for each, decrypt the TZA, unwrap its DEK with the wrapping key, decrypt and authenticate the whole body (Annex A §A.4); compare size, SHA-256 and `tzaSizeBytes` with the manifest. Nothing is kept.
5. Trailer: HMAC and immediate EOF.
6. Open `incoming.db` with the artifact key and verify it per Annex B §B.4, including: the set of `attachments.id` equals the manifest's ids exactly, and each row's `file_name`, `mime_type`, `size_bytes`, `sha256`, `format_version` equals the manifest entry.
7. Delete `D/check/<checkId>/`. Report the result, the backup ID and the trailer value (used in §8.3).

Space: `1 × database.sizeBytes + 16 MiB` in `D` (§9.6). Argon2 runs before step 6 and is finished (its memory released) before SQLCipher work starts. `temp_store = MEMORY` is set on staging connections (Annex B §B.2); its memory use is separate from the disk rule and is documented, with no `largeHeap`.

Only `schemaVersion = 3` is accepted. A future migration of older backups must be specified separately, with its own space factor.

---

# 8. Restore

## 8.1 Entry points and preconditions

- **Settings → Restore backup**, when the app is open normally.
- **The storage-error screen** (`src/screens/StorageErrorScreen.tsx`, now "retry only"), when the live database can't be used, for these codes only: `DATABASE_UNREADABLE`, `DATABASE_CORRUPT`, `MIGRATION_FAILED`, `SNAPSHOT_FAILED` (`src/storage/errors.ts:5-26`). For key errors (`KEY_MISSING_FOR_DATABASE`, `MASTER_KEY_MISSING`, `UNWRAP_FAILED`, `KEY_INVALIDATED`, `KEY_NOT_FOUND`, `INVALID_KEY_FORMAT`), the error screen shows `RESTORE_UNAVAILABLE` and offers no Clear storage. For `NEWER_SCHEMA`/`ENVELOPE_UNSUPPORTED` it says to update the app. Transient and other codes (`KEYSTORE_UNAVAILABLE`, `STORAGE_ERROR`, `DATABASE_STATE_UNKNOWN`, `WRITE_FAILED`, `KEY_ALREADY_EXISTS`, `INVALID_ARGUMENT`, `UNKNOWN`) offer only Retry, no restore entry.

Preconditions (both entry points):

1. The device database key exists and unwraps (`vault.getKey('database')`).
2. The attachments key: if it exists, it unwraps. If it is missing, it may be created only if `hasAnyFile` (§8.6) finds no encrypted attachment file in **any** of `L_att`, `S_att`, `P_att`, `N/quarantine/*`; otherwise `RESTORE_UNAVAILABLE`.
3. No restore journal exists (otherwise recovery runs first, §8.5).
4. From the error screen: `D/trezor.db-journal` MUST NOT exist (a hot journal of an unreadable database can't be moved safely); otherwise the restore is refused (`RESTORE_STATE_UNKNOWN`). No live connection is open, `completeFired` is skipped, and device-local settings use defaults.
5. `D/trezor.db` exists (checked with the definite file-state rule, `src/storage/database.ts:62`). A normal open always has it. On the error screen, `DATABASE_UNREADABLE` can also come from a failed *create* (`database.ts:90-93`); without a database file the restore entry is not offered and only Retry is shown. So `hadDatabase` is always `true` in v1 (§8.4).

## 8.2 Sequence in the restoring process

| # | Step | Layer | Journal after |
|---|---|---|---|
| 1 | Validate password, memory, free space (§9.6) | K | — |
| 2 | Acquire the restore gate (§8.7); the UI shows a blocking "Restoring…" screen | JS | — |
| 3 | Write the journal (`phase = prepared`, §8.4) | K | prepared |
| 4 | Create `S_att` **always, also when the backup has no attachments** (H1), and `fsync N/restore`. Decrypt the database section to `D/restore/incoming.db`; decrypt every attachment section, verify it (Annex A §A.4), rewrap the DEK to the device attachments key, write `S_att/<id>.tza`, decrypt the written file again under the device key; verify the trailer and EOF | K | prepared |
| 5 | If a Check ran before in this flow: backup ID and trailer value MUST equal those of the Check (§8.3) | K | prepared |
| 6 | Open `incoming.db` (artifact key), verify (Annex B §B.4) and the manifest ↔ rows equality (§7 step 6); export it to `S_db` under the **device** database key (Annex B §B.5); set `user_version = 3`; read the live device-local settings through the gate's callback (§5) and rewrite settings (§8.8); `integrity_check`, `foreign_key_check`, schema check on `S_db`; close; delete `incoming.db` | JS | prepared |
| 7 | Retained files (§9.2): determine the retained set from `L_att/kept-ids`, then hard-link (or, if that fails, copy) each `L_att/<id>.tza` to `N/quarantine/<restoreId>/<id>.tza`; the target MUST NOT exist | K | prepared |
| 8 | `fsync` every staged file; `fsync` `S_att`, `D/restore`, `N/restore`, `N/quarantine/<restoreId>`, `N/quarantine` | K | prepared |
| 9 | If the live database is open: read the fired ids and run `completeFired` on it, as `reconcile` does (`src/reminders/scheduler.ts:61-86`) | JS | prepared |
| 10–11 | **One** native call `saveAndClearSchedule` holding the `ScheduleStore` lock for its whole duration (§8.11): (a) copy `N/reminders/schedule.bin` byte for byte to `N/restore/schedule.saved.bin` (temp file, `fsync`, rename, `fsync N/restore`); (b) update the journal with `scheduleSaved = "saved"`, or `"absent"` if no schedule file exists; (c) clear: the effect of `ReminderScheduler.sync(entries = [])` (cancels alarms and shown notifications of every scheduled id and empties `fired`, `reminders/ReminderScheduler.kt:146-158`) and cancelling every active notification whose tag starts with `reminder:` (`reminders/ReminderNotifications.kt:29-30,99-101`); (d) confirm the stored record is empty | K | prepared |
| 12 | Purge decrypted caches (§8.9) | K | prepared |
| 13 | Close the live connection from inside the gate's callback, after the owner's last statement (§5). Work that was queued **behind** the gate never runs: it is discarded with the process, and the restore screen allows no user writes. Confirm `D/trezor.db-journal` does not exist | JS | prepared |
| 13a | **Pre-swap state check (H1):** the files MUST match the `prepared` row exactly: `L_db` and `S_db` present; `S_att` present (a directory); `P_db`, `P_att` absent; `L_att` present iff `hadAttachments`; no `-journal` next to `L_db` or `S_db`. Anything else is a pre-swap failure (§8.2 failure handling; the connection is already closed, so it ends in a restart) | K | prepared |
| 14 | Journal `phase = swapping`; perform the swap renames (§8.5). If a rename fails, write `phase = rollingback` and roll back (M-d); if the journal can't be written either, restart (recovery then decides from the files) | K | swapping |
| 15 | Journal `phase = verifying` | K | verifying |
| 16 | Restart the process (§8.10) | K | verifying |

The new process verifies and finishes the restore in its startup recovery (§8.5). The restoring process never reopens a database after step 13, and never reconciles reminders after step 10–11.

**Failure handling in the restoring process:**

- **Steps 1–2:** nothing changed; report the error.
- **Steps 3–12 (live connection still open):** "pre-swap failure":
  1. Restore the schedule (§8.11, one native call under the lock).
  2. Delete `D/restore/`, `N/restore/attachments/`, `N/quarantine/<restoreId>/`.
  3. Delete the journal.
  4. Release the gate and request a normal reconcile.

  The old UI then continues.
- **From step 13 on (the connection is closed):** every exit ends in a process restart (or termination if restart isn't possible); the gate is never released to the old UI. A failure before step 14 (including a failed step 13a) leaves `phase = prepared`, which recovery treats as a pre-swap failure. A failure during step 14 writes `phase = rollingback` as stated in step 14.

## 8.3 Check → Restore consistency

The restore pass is a full verification on its own. If the user ran Check on the same file in this flow, the restore pass MUST also confirm the same backup ID and the same 32-byte trailer value; otherwise it aborts before step 6 (`BACKUP_CHANGED`).

## 8.4 Journal

`N/restore/restore.json`, UTF-8 JSON, strictly parsed:

```json
{"format":"trezor-restore-journal","version":1,"restoreId":"<32 hex>","backupId":"<32 hex>",
 "phase":"prepared","hadDatabase":true,"hadAttachments":true,"scheduleSaved":"pending","createdAt":1793000000000}
```

`phase` ∈ `prepared`, `swapping`, `verifying`, `cleanup`, `rollingback`, `rolledback`. `hadDatabase` MUST be `true` (§8.1 precondition 5); `false` is `RESTORE_STATE_UNKNOWN`. `hadAttachments` records whether `L_att` existed at step 3. `scheduleSaved` ∈ `pending` (step 10 not completed, alarms not yet cleared), `saved`, `absent`. Paths are fixed (§2) and not stored.

Each update: write `restore.json.tmp`, `fsync`, rename over `restore.json`, `fsync N/restore`. A `.tmp` file is never authoritative and is deleted during recovery. A journal that can't be parsed → `RESTORE_STATE_UNKNOWN`.

## 8.5 Swap, recovery and the state matrix

Swap renames, in order (each followed by `fsync` of both parent directories):

- a: `L_att → P_att` (skipped if `hadAttachments = false`)
- b: `S_att → L_att`
- c: `L_db → P_db`
- d: `S_db → L_db`

Rollback renames, in order:

- r1: `L_db → S_db`
- r2: `P_db → L_db`
- r3: `L_att → S_att`
- r4: `P_att → L_att` (skipped if `hadAttachments = false`)

**Recovery entry point:** the first step of `openStorage` initialization (`src/storage/openStorage.ts:83`), before `openTrezorDatabase`, migrations, attachment GC (`:98`) and before any provider (and so any reminder reconcile) mounts. JS asks Kotlin for the journal phase and the file state, then runs the action below: file actions in Kotlin, database checks in JS. The F9 shared initialization (`:42-80`) makes Retry re-run recovery, which is idempotent.

File state: `A = (L_att, S_att, P_att)` (attachment directories) and `B = (L_db, S_db, P_db)` (database files), each `1` = present, `0` = absent. A directory or file being deleted counts as present. `S_att` exists from step 4 on, also when empty (H1). Table 1 is for `hadAttachments = true`, table 2 for `hadAttachments = false`. `hadDatabase` is always `true` (§8.4).

**Table 1 — `hadAttachments = true`**

| Phase | A | B | Action |
|---|---|---|---|
| none, `N/restore` or `D/restore` present | any | any | The journal is written before anything else and deleted last, so leftovers without a journal should be staging only. **Guard (M-c):** if `D/restore/previous.db` (`P_db`), `N/restore/previous-attachments/` (`P_att`) or `N/restore/schedule.saved.bin` exists, this is `RESTORE_STATE_UNKNOWN` and nothing is touched. Otherwise delete `D/restore/` and `N/restore/`. **Never** touch `N/quarantine/` (a successful restore leaves its quarantine with no journal). Continue startup |
| prepared | 1,·,0 | 1,·,0 | Pre-swap failure (also after a failed step 13a): restore the schedule (§8.11), delete `D/restore/`, `N/restore/attachments/`, `N/quarantine/<restoreId>/`, then the journal; continue |
| swapping | 1,1,0 | 1,1,0 | do a, b, c, d → verifying |
| swapping | 0,1,1 | 1,1,0 | do b, c, d → verifying |
| swapping | 1,0,1 | 1,1,0 | do c, d → verifying |
| swapping | 1,0,1 | 0,1,1 | do d → verifying |
| swapping | 1,0,1 | 1,0,1 | → verifying |
| verifying | 1,0,1 | 1,0,1 | JS verifies `L_db` with the device key per Annex B §B.4, and that `attachments.id` equals the `.tza` set in `L_att`. Pass → cleanup. Deterministic failure → rollingback. Transient failure (key unavailable, I/O) → keep the journal, show `RESTORE_VERIFY_RETRY` with Retry |
| cleanup | 1,0,· | 1,0,· | Delete `P_att`, `P_db`, `N/restore/schedule.saved.bin`, `D/restore/`, `N/restore/attachments/`, then the journal; continue startup (reconcile arms the restored reminders, §8.11) |
| rollingback | 1,0,1 | 1,0,1 | r1, r2, r3, r4 → rolledback |
| rollingback | 1,0,1 | 0,1,1 | r2, r3, r4 → rolledback |
| rollingback | 1,0,1 | 1,1,0 | r3, r4 → rolledback |
| rollingback | 0,1,1 | 1,1,0 | r4 → rolledback |
| rollingback | 1,1,0 | 1,1,0 | → rolledback |
| rolledback | 1,·,0 | 1,·,0 | Restore the schedule (§8.11); delete `S_att`, `S_db`, `D/restore/`, `N/quarantine/<restoreId>/`, then the journal; continue startup on the previous data |

**Table 2 — `hadAttachments = false`** (`L_att` absent before the swap; rename a and r4 are skipped; `P_att` never exists, so its presence is `RESTORE_STATE_UNKNOWN`). The "none" row is the same as in table 1.

| Phase | A | B | Action |
|---|---|---|---|
| prepared | 0,·,0 | 1,·,0 | Pre-swap failure, as in table 1 |
| swapping | 0,1,0 | 1,1,0 | do b, c, d → verifying |
| swapping | 1,0,0 | 1,1,0 | do c, d → verifying |
| swapping | 1,0,0 | 0,1,1 | do d → verifying |
| swapping | 1,0,0 | 1,0,1 | → verifying |
| verifying | 1,0,0 | 1,0,1 | As in table 1 |
| cleanup | 1,0,0 | 1,0,· | As in table 1 (no `P_att` to delete) |
| rollingback | 1,0,0 | 1,0,1 | r1, r2, r3 → rolledback |
| rollingback | 1,0,0 | 0,1,1 | r2, r3 → rolledback |
| rollingback | 1,0,0 | 1,1,0 | r3 → rolledback |
| rollingback | 0,1,0 | 1,1,0 | → rolledback |
| rolledback | 0,·,0 | 1,·,0 | As in table 1 |

`·` means either value. The rows above are the only states reachable through single, durable renames from a state that passed step 13a. **Every other combination** (for example a file in two places, a pair with neither source nor target, `D/trezor.db-journal` present in phases `swapping` to `rolledback`, `hadDatabase = false`, an unknown phase) is `RESTORE_STATE_UNKNOWN`: nothing is touched, the error screen shows the code, and no Clear storage is offered.

**Failed recovery actions (M-d).** Recovery never makes progress at the cost of a state it can't retry from:

- If any recovery action fails (a rename, a deletion, a directory sync, the schedule restore, a journal write), recovery stops immediately and leaves the journal and every file as they are. The error screen shows `RESTORE_RECOVERY_RETRY` with Retry. Retry starts recovery again from the journal and the files; every action is idempotent, so a partly done step is found and continued.
- **`swapping`:** if a roll-forward rename fails, recovery writes `phase = rollingback` and rolls back instead. If writing that journal update fails, recovery stops with `RESTORE_RECOVERY_RETRY`, and the next attempt starts again from `swapping`.
- **`rollingback`:** a failed rename stops with `RESTORE_RECOVERY_RETRY`. Recovery never switches back to rolling forward.
- **`verifying`:**
  - A transient failure (key temporarily unavailable, I/O) gives `RESTORE_VERIFY_RETRY` and keeps the journal.
  - A device database key that is missing or invalidated gives `RESTORE_UNAVAILABLE` and keeps the journal and all files (no rollback either, since the previous database needs the same key).
  - A deterministic verification failure writes `rollingback`.
- **`cleanup` / `rolledback`:** a partly done deletion is simply continued on retry.

Assumption A6, a platform assumption and not a proof: a rename within one ext4/f2fs filesystem is crash-atomic, and it is durable once both parent directories are `fsync`ed. JVM tests prove the state machine under A6; device tests with process kills are required; true power-loss behaviour is not proven.

## 8.6 Key rule for attachments (`hasAnyFile`)

`hasAnyFile` (`attachments/AttachmentStore.kt:260-272`, used by `AttachmentKeys.obtain`, `attachments/AttachmentKeys.kt:18-43`) MUST consider `.tza` files in `L_att`, `S_att`, `P_att` and every `N/quarantine/*/`, each with the existing fail-closed listing rule. This is part of Step 3, not of the prerequisites.

## 8.7 Restore gate

Covers, from step 2 until success or pre-swap release:

- the serialized database queue and the `ItemsProvider` queue (writes queue; nothing new is accepted from the UI, which is replaced by the restore screen);
- settings writes;
- the reminder reconcile queue;
- native WORKER tasks: imports, deletes, views, PDFs, exports, shares.

The restore coordinator owns the gate: its own live-database statements (the settings read in step 6, and steps 9 and 13) run through the gate's callback (§5), so they don't wait behind the gate.

A picker result arriving after the gate is rejected and its imported files deleted. A share is "active" while its copy is in `ShareFiles.active`. Restore waits (with a visible message and Cancel) until no share is active; no new share can start. The gate is released only on the pre-swap failure path (§8.2).

## 8.8 Settings in the staged database

In `S_db`, before it is closed:

1. Delete every `settings` row whose key is not `theme.preference` or `notifications.showDetails`.
2. Keep those two only if their JSON value is valid (`"system"`, `"light"`, `"dark"`; `true`, `false`); otherwise delete them (defaults apply, `src/storage/SettingsRepository.ts:5-51`).
3. Insert `notifications.permissionRequested` and `notifications.exactAlarmRequested` from the live database when it is readable and the values are valid booleans; otherwise insert nothing (default `false`).
4. Future Phase 5 app-lock settings follow the device-local rule of step 3.

## 8.9 Decrypted caches and notifications

Before the swap: views and PDFs (`C/attachments/view`, via `AttachmentViews.purge`, `attachments/AttachmentViews.kt`) and shares (`C/attachments/share`, all, including recent ones) are deleted, and the directories are confirmed empty. A failure here is a pre-swap failure. Notifications: §8.2 step 10–11.

## 8.10 Process restart

Evidence: one `singleTask` activity, no `android:process` (`AndroidManifest.xml`), `targetSdkVersion 36` (`android/build.gradle:6`), so the Android 14+ limits on background activity starts apply.

Mechanism: while the restore screen is visible (the app is in the foreground, so starting its own activity is allowed), start `MainActivity` with `Intent.makeRestartActivityTask`, finish the task, then end the process (`Process.killProcess(myPid())`). If the app is not in the foreground at that moment, no activity is started: the journal is durable, the process ends, and recovery runs at the next launch. In every case the data is safe, because recovery runs at the next start.

**Foreground test (L8):** "in the foreground" means the React context's current activity is `MainActivity` and its `Lifecycle` state is at least `RESUMED`. `MainActivity` extends `ReactActivity`, which extends `AppCompatActivity` (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/ReactActivity.java:24`), so this needs no new dependency.

**Long operations in the background (L8, decision):** backup and restore run without a foreground service in v2.4. The progress screens tell the user to keep Trezor open. If Android ends the process, backup fails safely (§6.4 leftovers), and restore recovers at the next launch from its journal.

The reliability of the immediate relaunch on API 34–36 is not verified (`14-unresolved.md` U1). If it proves unreliable, a separate trampoline process may be added after a review, since it changes the single-process assumption of `EnvelopeStore` (it MUST NOT touch the vault, the database or files). The fallback is a terminal screen: "Restore isn't finished yet. Close and reopen Trezor to complete it." (The phase is still `verifying` at that point, L6.)

## 8.11 Reminder state

There is no reminder floor (`noArmBefore` is withdrawn, M1). Reason, from the code: the native side arms an occurrence in the past only through the previously armed occurrence (`previous`/`armedFor`, `reminders/ReminderScheduler.kt:97-120`). Otherwise it arms the first occurrence strictly after now (`reminders/Recurrence.kt:127-134`), for every repeat type. Step 10–11 empties the schedule and its `armedFor` values and `fired`. The first reconcile in the new process (`src/reminders/scheduler.ts:23-30,61-86`) therefore cannot fire any occurrence from before the restore, ONCE or recurring. It arms future occurrences normally.

**Shared lock (M-b, decision 5).** Every read-modify-write of the schedule already holds the `ScheduleStore` object's monitor: `load`, `save` and `update` are `@Synchronized` (`reminders/ScheduleStore.kt:75,94,118`), and `sync`, `rearmAll` and `onFire` do their work inside `ScheduleStore.update` (`reminders/ReminderScheduler.kt:146-205`). The two restore operations below each hold **that same monitor for their whole duration** (the monitor is reentrant, so they can call `update` inside). An alarm (`ReminderAlarmReceiver` → `onFire`) or a boot, time or zone change (`ReminderRestoreReceiver` → `rearmAll`, `reminders/ReminderReceivers.kt:9-18,31-39`) arriving meanwhile waits and then runs on the result:

- **`saveAndClearSchedule`** (step 10–11): copy, journal update, clear, confirm, as one critical section. A receiver that runs afterwards finds an empty schedule: `onFire` finds no entry and cancels (`ReminderScheduler.kt:179-184`), and `rearmAll` arms nothing.
- **`restoreAndRearmSchedule`** (pre-swap failure and `rolledback`): steps 1–3 below, as one critical section.

The lock order stays as today: `ScheduleStore` monitor, then the vault lock (inside `withKey`, `ScheduleStore.kt:65-72`). Nothing that holds the vault lock takes the `ScheduleStore` monitor.

Restoring the schedule (`restoreAndRearmSchedule`), idempotent (M-a):

1. By the journal's `scheduleSaved`:
   - `saved` **and `schedule.saved.bin` present**: copy it back to `N/reminders/schedule.bin` (temp, `fsync`, rename, directory `fsync`).
   - `saved` **and `schedule.saved.bin` absent**: the copy-back already completed in an earlier attempt (step 3 below deletes the file only after it); skip to step 2. (`saved` is written only after the saved file is durable, step 10–11 (a)–(b), so "saved but absent" can't mean "never saved".)
   - `absent`: no schedule existed; delete `schedule.bin` if present.
   - `pending`: the alarms were never cleared; leave `schedule.bin` as it is (delete a stray `schedule.saved.bin` temp file).
2. Call the logic of `ReminderScheduler.rearmAll` (`reminders/ReminderScheduler.kt:162-169`). It re-arms every entry with its saved `armedFor`, so a pending, not yet delivered ONCE reminder stays armed, and `fired` is back. Running it twice is harmless.
3. Delete `schedule.saved.bin`.
4. The caller then continues its recovery row (the journal is deleted last). The normal reconcile, once the app runs, completes fired ONCE reminders in the database.

A failure in steps 1–3 is a failed recovery action (§8.5): the journal and the saved file stay, and Retry repeats the operation.

Accepted limitation (L8): notifications that were already shown for the old data and cancelled in step 10–11 are not shown again after a pre-swap failure or a rollback. The reminders themselves, their alarms and `fired` are restored.

On success, `cleanup` deletes `schedule.saved.bin`. The reconcile after startup arms the restored reminders.

Limitation: a device reboot while a restore journal exists re-arms from the cleared schedule (nothing armed) until the app is opened and recovery has run.

---

# 9. Shared rules

## 9.1 Snapshots

Migration snapshots (`src/storage/snapshot.ts:13-27`) are neither moved nor deleted by backup, Check or restore, and are not part of a backup. They stay encrypted under the device database key, which a restore keeps.

## 9.2 `kept-ids` and `tmp/`

`S_att` contains only the restored `<id>.tza` files (possibly none): no `kept-ids`, no `tmp/` (the store creates `tmp/` when needed, `attachments/AttachmentStore.kt:52,93`). The old root moves to `P_att` with its `kept-ids` and `tmp/`. On rollback it comes back unchanged; on success it is deleted in `cleanup`, after the retained files were linked or copied to `N/quarantine/<restoreId>/` in step 7.

**Retained set (step 7, L7, decision 6).** The aim is to keep every encrypted file that may still belong to the user:

| `L_att/kept-ids` | Retained set |
|---|---|
| absent | empty |
| valid (`AttachmentStore.keptIds`, `AttachmentStore.kt:244-258`) | the listed ids; an id listed without a file is skipped (nothing to keep) and counted in the restore result |
| present but unreadable or damaged (`keptIds()` throws `IO_FAILED`, `:250-256`) | **fail closed: every `.tza` file in `L_att`** (all ids matching the id pattern), since it can't be known which of them are retained |
| `L_att` itself can't be listed | pre-swap failure with `STORAGE_ERROR` (nothing has changed yet) |

**Quarantine has no automatic cleanup (decision 6):**

- `N/quarantine/` grows by one directory per restore that retained files.
- Only the pre-swap failure path and `rolledback` delete `N/quarantine/<restoreId>/` of *that* restore. They can, because the originals are still in `L_att`, and a hard link or copy deleted there leaves the original intact (`.tza` files are never rewritten in place, `AttachmentStore.kt:13-14`).
- Quarantine is not part of backups, so it is not carried to another device; that is documented in the UI and docs.
- It is never shown as restored content, and is outside GC (`collectGarbage` lists only `.tza` files directly in the root, `attachments/AttachmentStore.kt:190-201`).
- Browsing or removing quarantined files is a future feature.

## 9.3 File operations

New native operations (Step 3):

- `syncDirectory(dir)`
- `renameNoReplaceDurable(from, to)`: target must be absent; rename; `fsync` both parents. Atomic no-replace relies on the gate and the single process.
- `linkOrCopyDurable(src, dst)`
- `deleteRecursively(dir)`: limited to `D/restore`, `D/check/*`, `D/backup`, `N/restore`, and `N/quarantine/<restoreId>` of the current journal's restore only.

Paths are built only from the fixed layout (§2) and validated ids (Annex A §A.7).

Prerequisite (before Step 1, separately reviewed): `DatabaseFiles.renameNoReplace` (`android/.../storage/DatabaseFiles.kt:39-45`) also `fsync`s its directory.

## 9.4 Logging

Error codes only; never passwords, keys, file names, ids or paths.

## 9.5 Memory

Argon2id (64 MiB) and SQLCipher work run one after the other, never at the same time. Key, password and buffer arrays owned by Trezor are zeroed in `finally`. BouncyCastle's internal Argon2 blocks may not be cleared after an exception or OOM; this is a documented limitation.

## 9.6 Free space

`D` and `N` are on the same partition in the standard layout (both under the app's data directory). Requirements are therefore grouped by filesystem (`Os.stat(path).st_dev`), summed per filesystem, and compared with `StatFs(path).availableBytes`:

| Flow | Requirement |
|---|---|
| Backup | export file `≈ 1 × live DB size` + 16 MiB (in `D`) |
| Check | `database.sizeBytes` + 16 MiB (in `D`) |
| Restore | `incoming.db` (= `database.sizeBytes`) + `S_db` (estimate `database.sizeBytes`) + Σ `tzaSizeBytes` + 16 MiB; quarantine links need none (a copy fallback needs Σ kept sizes); old data stays until cleanup |

Insufficient space aborts before step 3 (restore) or before writing (backup). `SQLITE_FULL` during an export is handled as a failure of that flow (§6.4, pre-swap failure).

---

# 10. Implementation plan

**Prerequisites** (before Step 1, each separately reviewed and committed):

1. Corrective D:
   - Low-1 (a later root's initial data load can miss a write that finished just before it mounted);
   - Low-3 (`try/finally` around the editor save and its `savingRef`);
   - expired-share purge at native module start (respecting `active`);
   - bounded `AttachmentFormat.rewrap`: it copies exactly the expected body length and fails on early or late EOF.
2. `DatabaseFiles` directory sync (§9.3).

**Steps 1–5:**

| Step | Content | Includes |
|---|---|---|
| 1 | Format and cryptography library | §3, §4, Annex A rules for sections, UCD 8.0 table and generator, vectors (§13); no app or database changes |
| 2 | Backup creation and Check | §6, §7, Annex B |
| 3 | Restore preparation | §8.1–8.4, §8.6–8.9, §9.2–9.3, restart (§8.10), schedule save/restore (§8.11); exercised without the swap |
| 4 | Swap, recovery, rollback | §8.5 |
| 5 | UI | Settings screen, error-screen entry, progress, cancel, messages; docs |

Each step: inspect the repository first, tests for its whole scope, all checks green, a local commit, a review before the next step, no push.

---

# 11. Security requirements

- No plaintext database or attachment is written outside the existing short-lived view/share caches.
- No secrets in logs.
- Device keys never reach JS, except the existing `database` key and the SQLCipher artifact key (§5).
- Unknown versions, identifiers, types and fields are rejected.
- Manifest data is trusted only after it matches the database and the files.
- A rewrap is not proof of integrity; every body is decrypted and authenticated.
- No network permission.
- No change to signing keys.
- No Git history rewriting.

---

# 12. Verification environments

- Unit and JVM tests on the Mac.
- A SQLCipher 4.19.0 harness for database artifacts.
- Instrumentation on a **new dedicated AVD**, never the shared emulator or the A53.
- An Argon2 benchmark on a physical reference device (5 runs, median and max, target median ≤ 5 s) only with separate approval.

The latest instrumentation results predate Phase 4 (2 Nov 2026), so the Phase 4 and corrective changes need to be included in the next instrumentation run.

---

# 13. Required tests (acceptance)

**Format (Step 1)**

1. Header byte layout and CRC against an independent CRC-32/ISO-HDLC implementation; every field's rejection.
2. `m ≠ 65536`, `t ∉ 3…10`, `p ≠ 1`, an unknown KDF or cipher id, non-zero reserved bytes are rejected before Argon2; the memory pre-check.
3. Argon2id vectors cross-checked with libsodium (`crypto_pwhash_argon2id`, no secret/AD).
4. BMK wrap with the canonical-header AAD; changing any header byte makes the unwrap or the trailer fail.
5. HKDF vectors for all four key kinds, plus RFC 5869 test vectors.
6. Nonce and AAD byte-layout vectors; the enumeration of all `(key, nonce)` pairs of a complete file is free of repeats.
7. Length rule: every `L` from 0 to `3(c+16)+1` against the inverse formula; empty sections; exact chunk multiples; rejection before allocation.
8. Unknown section type; wrong ordinal, order or count; truncated, extended or reordered chunks; a section swapped between files; trailing bytes; a missing trailer.
9. Manifest: every field's type, range, absence, `null`, duplicate key, unknown key, duplicate id, unsorted ids, fractional or large numbers; the 16 MiB limit; the canonical writer output.
10. Password: the vectors of §4 (accept, `Cc`, `Cf` incl. bidi and U+00AD and U+FEFF and tags, ZWJ and ZWNJ accepted, variation selectors accepted, `Co`, `Cn`, noncharacters, Unicode 9.0+ characters, lone surrogates, NFC equivalences, length limits before and after NFC); the table checksum.
11. Annex A: TZA header, wrap AAD and body AAD vectors; `tzaSize`; a chunk size ≠ 65536 rejected in backups; id pattern and path rules; the bounded rewrap.

**Backup and Check (Step 2)**

12. A complete backup passes read-back; the live database and every file are byte-identical afterwards.
13. No other database statement runs between ATTACH and DETACH (a recording queue).
14. Attachment rows come from the export; a delete queued during the gate waits and runs after release; a deletion of an exported id is deferred natively.
15. The gate is released after the last section, before read-back; writes queued during it run in order afterwards.
16. `SQLITE_FULL` during the export (fixed-size disk image): the export file is removed, the live DB is unchanged, the gate is released.
17. The SAF provider: an unknown or non-zero size is refused; a failed read-back never reports success.
18. Check rejects each corruption class and a wrong password; the manifest ↔ DB row equality in both directions; Check writes no live file.
19. The SQLCipher parameter checks and the schema check of Annex B; the space bounds on a fixed-size image, exactly at the limit and one byte below.

**Restore (Steps 3–4)**

20. The restore pass rejects a backup whose ID or trailer differs from the preceding Check.
21. The settings rewrite (§8.8) with valid, invalid and missing values, with a readable and an unreadable live DB.
22. Retained files are linked or copied to quarantine; quarantine ids never collide with restored ids; `hasAnyFile` sees every location; key creation is refused while any file exists.
23. Gate: a late picker result is rejected and its files deleted; an active share blocks; no new share starts.
24. Schedule: a pending, undelivered ONCE reminder and the `fired` set survive a pre-swap failure and a rollback (re-armed by `rearmAll`, completed by the next reconcile).
25. Restore with an overdue ONCE reminder and with a recurring reminder whose last occurrence was 30 minutes earlier: neither fires after the restart; the next recurring occurrence and future ONCE reminders are armed.
26. Before the swap, no alarm of the old dataset remains and no notification with a `reminder:` tag is shown; a failure to clear prevents `swapping`.
27. Caches: no view, PDF or share copy of the old dataset remains after a successful restore; a cache-purge failure prevents `swapping`.
28. Every row of the §8.5 matrix, with both `had*` variants; every other combination fails with `RESTORE_STATE_UNKNOWN` (exhaustive over phase × A × D × flags); a kill after every single operation followed by recovery twice (idempotence); a `.tmp` journal ignored.
29. Before `swapping` a failure returns to the old UI with the gate released; from the close of the live connection on, no path returns to the old UI.
30. Recovery runs before `openTrezorDatabase`, migrations, GC and reconcile; a transient verification failure keeps the journal.
31. Error-screen entry for each code in §8.1; `RESTORE_UNAVAILABLE` for key codes; a hot journal refuses the restore.
32. Restart (instrumentation on the dedicated AVD, API 34–36): foreground relaunch, background termination, and recovery at the next launch.
33. Filesystem-level tests (Step 4): renames and directory syncs on a real filesystem with process kills; insufficient space before step 3.
34. Restore on another installation with a different signing certificate (dedicated AVD).

**Added in v2.4**

35. **H1:** restore of a backup with zero attachments, with `hadAttachments` true and false: `S_att` exists (empty), the swap completes, verification passes; a removed `S_att` before step 14 is caught by step 13a as a pre-swap failure, never reaching `swapping`.
36. **Step 13a:** each deviation from the `prepared` row (missing `S_db`, present `P_db`/`P_att`, `L_att` present against `hadAttachments`, a `-journal` file) is a pre-swap failure.
37. **M-a:** a kill after each of steps 1, 2 and 3 of `restoreAndRearmSchedule`, followed by recovery, ends with the restored schedule armed (pending ONCE kept, `fired` kept) and the journal deleted; `saved` with the file already gone skips the copy.
38. **M-b:** with the `ScheduleStore` monitor held by `saveAndClearSchedule` or `restoreAndRearmSchedule` (a latch inside the critical section), an `onFire` and a `rearmAll` started meanwhile block until it ends and then run on its result; the saved copy equals the record at the clear; the restored file is not overwritten by an empty record.
39. **M-c:** no journal, with each of `P_db`, `P_att`, `schedule.saved.bin` present: `RESTORE_STATE_UNKNOWN`, nothing deleted; no journal with staging only: staging deleted, quarantine untouched.
40. **M-d:** failure injection for every recovery action of every row: the journal and files stay, `RESTORE_RECOVERY_RETRY` is shown, Retry completes; a failed roll-forward rename in `swapping` switches to `rollingback`; a failed rollback rename never switches forward; a failed journal write keeps the previous phase; a missing database key in `verifying` gives `RESTORE_UNAVAILABLE` with everything kept.
41. **M-e:** backup with one attachment missing, one damaged (body chunk modified) and one not matching its row: each fails with `BACKUP_ATTACHMENT_UNREADABLE` carrying the attachment id, `item_id` and reason; no destination file is reported as a backup; nothing is logged beyond the code.
42. **L3:** under the backup and restore gates, the owner's statements run through the gate callback (no deadlock), native steps make no live-database call, and statements queued behind the gate run after release (backup) or never (restore after step 13).
43. **L4:** startup removes `D/backup/*` and `D/check/*`; a pending SAF destination record leads to a deletion attempt and is cleared; a failed deletion produces the one-time notice.
44. **L5:** manifest with invalid UTF-8, an escaped unpaired surrogate, `versionName` of 64 and 65 code points, the attachment sum exactly 4 GiB (accepted) and 4 GiB + 1 (rejected), U+007F and U+0085 written raw by the canonical writer; header error precedence (wrong magic, wrong version with bad CRC, bad CRC with wrong `m`, wrong `m` with good CRC).
45. **L6:** error-screen codes `WRITE_FAILED`, `KEY_ALREADY_EXISTS`, `INVALID_ARGUMENT` offer Retry only; `DATABASE_UNREADABLE` without a database file offers no restore; a journal with `hadDatabase = false` is `RESTORE_STATE_UNKNOWN`.
46. **L7:** `kept-ids` absent, valid, valid with an id lacking its file, damaged (every `.tza` quarantined), unreadable root (pre-swap failure); quarantine survives cleanup and is removed only by its own pre-swap failure or rollback.
47. **L8:** the restart's foreground test (resumed vs paused/stopped activity); the progress screens' keep-open message; after a pre-swap failure, previously shown notifications are not re-posted while alarms and `fired` are restored.
