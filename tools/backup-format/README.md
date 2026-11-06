# Backup format reference and test vectors

Development tools for the TZBK v1 backup format (Phase 6 specification v2.4, §3–§4 and
Annex A). Nothing here ships in the app.

| File | Purpose |
|---|---|
| `reference.js` | An independent implementation of TZBK v1 and TZA v1 in Node's `crypto` (OpenSSL): Argon2id, HKDF-SHA256, AES-256-GCM, HMAC-SHA256, CRC32. It shares no code with the Kotlin library (BouncyCastle and `javax.crypto`). |
| `make-vectors.js` | Writes `android/app/src/test/resources/backup/tzbk-v1-vectors.json` from fixed inputs, using `reference.js` only. Deterministic: the same inputs give the same file. |
| `check-argon2-libsodium.py` | Recomputes every Argon2id value in the vectors with libsodium (`crypto_pwhash`, `ALG_ARGON2ID13`), a third implementation. |
| `gen-unicode8-table.js` | Generates `android/app/src/main/java/com/trezor/app/backup/Unicode8Allowed.kt` (the password character set, spec §4.1) from the UCD 8.0.0 files. It refuses source files whose SHA-256 differs from the recorded one. |

## Regenerate and check

```sh
node tools/backup-format/make-vectors.js          # Node ≥ 24.7 (crypto.argon2Sync)
python3 tools/backup-format/check-argon2-libsodium.py   # brew install libsodium

# Unicode table (only when the generator changes; the sources are not in the repo):
curl -O https://www.unicode.org/Public/8.0.0/ucd/UnicodeData.txt
curl -O https://www.unicode.org/Public/8.0.0/ucd/DerivedAge.txt
node tools/backup-format/gen-unicode8-table.js .
```

Recorded UCD 8.0.0 checksums (SHA-256):

- `UnicodeData.txt`: `38b17e1118206489a7e0ab5d29d7932212d38838df7d3ec025ecb58e8798ec20`
- `DerivedAge.txt`: `302f6d6171dc9c6165db86d0226b7923a64cea06c493d339d35436bf137606a3`

The Kotlin tests (`com.trezor.app.backup.*`) compare their output with these vectors byte for
byte. The expected values never come from the Kotlin code under test.
