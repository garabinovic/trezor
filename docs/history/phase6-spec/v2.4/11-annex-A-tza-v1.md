# Annex A — TZA v1 encrypted attachment format (normative)

Part of Phase 6 specification v2.4 (unchanged in substance from v2.3). It documents the **existing** format as implemented, so that other implementations can read and write it. Nothing here changes the format.

Source of truth: `android/app/src/main/java/com/trezor/app/attachments/AttachmentFormat.kt:16-305` and `AttachmentStore.kt:9-59, 288-297` at commit `7277967`. Where this annex and the code differ, the code is right and the annex has to be corrected.

## A.1 Layout

```
file   = header[76] ‖ chunk₀ ‖ … ‖ chunkₖ₋₁
header = magic[4] ‖ version[1] ‖ chunkSize[4] ‖ wrapIv[12] ‖ wrappedDek[48] ‖ noncePrefix[7]
chunkᵢ = AES-256-GCM(DEK, nonceᵢ, AADbody, plaintextᵢ)  ;  |chunkᵢ| = |plaintextᵢ| + 16
```

| Offset | Size | Field | Value | Source |
|---:|---:|---|---|---|
| 0 | 4 | Magic | ASCII `TZA1` | `:41, :74` |
| 4 | 1 | Version | `0x01` | `:38, :75` |
| 5 | 4 | Chunk size | u32 big-endian; written as 65536 | `:39, :76` (`ByteBuffer` is big-endian) |
| 9 | 12 | Wrap IV | random | `:43, :104` |
| 21 | 48 | Wrapped DEK | AES-GCM ciphertext (32) ‖ tag (16) | `:45, :108` |
| 69 | 7 | Nonce prefix | random, per file | `:44, :180` |

Header length: 76 bytes (`:46`).

## A.2 Keys

- **DEK:** 32 random bytes per file (`:177`). It encrypts the body only.
- **Wrapping key:** 32 bytes (`:99-101`).
  - On the device: the KeyVault key `attachments` (`AttachmentKeys.kt:35-43`).
  - In a backup's attachment section: the TZBK *attachment DEK wrapping key* (spec §3.5).

## A.3 DEK wrapping

- `wrappedDek = AES-256-GCM(key = wrapping key, iv = wrapIv, aad = AADwrap, plaintext = DEK)`, tag 128 bits (`:103-109`).
- `AADwrap` = UTF-8 bytes of `trezor.attachment-dek|1|<id>` (`:83`). `<id>` is the attachment id (§A.7) as text; `1` is the version as decimal ASCII.

A failed unwrap means a wrong key or the wrong id (`KEY_MISMATCH`, `:111-123`).

## A.4 Body

- **AAD:** `AADbody` = UTF-8 bytes of `trezor.attachment|1|<id>|<chunkSize>|` followed by the 7 raw nonce-prefix bytes, where `<chunkSize>` is the header's chunk size in decimal ASCII (`:85-90`). For 65536: `trezor.attachment|1|<id>|65536|` ‖ prefix. The wrap fields are deliberately not part of `AADbody` (`:27-29`), so a rewrap leaves the body valid.
- **Nonce:** `nonceᵢ = noncePrefix[7] ‖ i[4] (u32 BE) ‖ last[1]`, where `last = 0x01` for the final chunk, else `0x00` (`:92-97`).
- **Chunks:** each chunk except the last carries exactly `chunkSize` plaintext bytes. The last carries `0 … chunkSize`. An empty file is one empty last chunk (`:186-215`). A file whose size is an exact multiple of `chunkSize` has **no** extra empty chunk: its last chunk is full and flagged last (`:197-198`). At most `2^31` chunks (`:208-210`).
- **Reading:** `decrypt` authenticates each chunk before writing its plaintext (`:228-278`). A failure can leave an authentic prefix in the output, which callers discard (`:33-34`). In the code, the last chunk is determined by end-of-stream (`:248-249`), so the input MUST be bounded to exactly the file length (spec §3.6).

## A.5 Rewrap

`rewrap` reads the header, unwraps the DEK with the old key, writes the header with the DEK wrapped under the new key with a new random `wrapIv`, and copies the body unchanged (`:280-304`). It does not authenticate the body.

Phase 6 requirements:

1. Before Step 1 (Corrective D), `rewrap` copies **exactly** `fileLength − 76` bytes and fails if its input ends early or continues after them. Today it copies to EOF (`:300`).
2. The section is the complete rewrapped file, 76 + body bytes (spec §3.10).
3. Every body is fully decrypted and authenticated with `decrypt` (or an equivalent streaming pass that both copies the ciphertext chunks unchanged and authenticates them):
   - at backup creation, under the device key;
   - at Check, under the backup wrapping key;
   - at restore, under the backup wrapping key before rewrapping, and again under the device key after writing.
4. The decrypted plaintext is discarded, except where the device already keeps it (never during backup, Check or restore).

## A.6 Sizes and limits

For a plaintext of `q` bytes and chunk size 65536:

`tzaSize(q) = 76 + q + 16 × max(1, ⌈q / 65536⌉)`

Example: `q = 1000` → 1092; `q = 0` → 92; `q = 65536` → 65628; `q = 65537` → 65645.

Limits:

| Context | Limit |
|---|---|
| Plaintext size `q` in the app | ≤ 25 MiB (`AttachmentImporter.kt:133`, `src/data/attachments.ts:4`) |
| Chunk size, device reader | 1 … 1 MiB (`:47-48, :137-139`) |
| Chunk size, TZBK v1 | **exactly 65536**; any other value in a backup is `BACKUP_UNSUPPORTED` |
| Version | exactly `1` (`:132-135`) |

## A.7 Attachment ids and paths

- **Id:** a lowercase UUID matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`AttachmentStore.kt:295-296`; the same pattern in `src/data/attachments.ts:51-55`). The app creates UUIDv7 ids. A reader MUST NOT require version 7.
- **Order of checks:** an id from a manifest, database row or file name MUST match the pattern **before** any path is built from it (`AttachmentStore.kt:54-59`). An id that fails the check rejects the whole backup (`BACKUP_INCONSISTENT`).
- **File names:** `<root>/<id>.tza`, plus `<root>/tmp/<id>.part` for imports in progress (`AttachmentStore.kt:13-19, 289-290`). Phase 6 adds `N/restore/attachments/<id>.tza` and `N/quarantine/<restoreId>/<id>.tza`, where `<restoreId>` is 32 lowercase hex characters generated by the app.
- **Other entries in an attachment root:** `kept-ids` (text: header line `trezor.kept-attachments|1`, then one id per line, `AttachmentStore.kt:212-258, 292-293`) and `tmp/`. They are not attachments and are never part of a backup. How a damaged `kept-ids` is handled during restore is spec §9.2 (every `.tza` in the root is then treated as retained).

## A.8 Test vectors (to be produced in Step 1)

Fixed DEK, wrapping key, id, wrap IV and nonce prefix; plaintexts of 0, 1, 65535, 65536, 65537 and 131072 bytes. For each, the vector gives the header bytes, `AADwrap`, `AADbody`, every nonce, the complete file bytes, and the rewrapped file under a second key.

The vectors are generated with the existing Kotlin code (with `SecureRandom` replaced by a fixed source in the test) and checked by a second, independent implementation.
