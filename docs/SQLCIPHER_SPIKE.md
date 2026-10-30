# SQLCipher compatibility spike — results

Date: 2026-10-30 · Device: Android emulator, API 37 (arm64-v8a) · Debug build

## Setup

- `@op-engineering/op-sqlite` **19.0.3** (exact pin)
- `package.json`: `"op-sqlite": { "sqlcipher": true }`
- React Native 0.88.1, New Architecture, Hermes
- Gradle printed `[OP-SQLITE] using sqlcipher.`; native build succeeded (`BUILD SUCCESSFUL`)

A temporary script (removed after the spike) created throwaway databases and
logged results to logcat. Database files were then pulled with
`adb exec-out run-as com.trezor.app cat databases/<file>` and inspected on the host.

## Results — runtime (from logcat)

| Check | Result |
| --- | --- |
| `isSQLCipher()` | `true` |
| `PRAGMA cipher_version` | `4.19.0 community` |
| `PRAGMA cipher_provider` | `openssl` |
| Passphrase key, correct | Opened, read marker row |
| Passphrase key, wrong | `file is not a database (code 26)` |
| No key on encrypted file | `file is not a database (code 26)` |
| Raw key `x'<64 hex>'`, correct | Opened, read marker row |
| Raw key, wrong | `file is not a database (code 26)` |
| Raw key's hex digits passed as a passphrase | `file is not a database (code 26)` — confirms `x'…'` is parsed as a raw key, not as text |
| Open time, passphrase vs raw key | ~300–700 ms vs ~10 ms — raw key skips PBKDF2 (256,000 iterations) |

## Results — on disk (host inspection)

| File | First 16 bytes | Marker string found | Host `sqlite3` |
| --- | --- | --- | --- |
| `spike-a.db` (passphrase) | `7be7c6b0…` (random) | 0 | `file is not a database` |
| `spike-raw.db` (raw key) | `f44419c1…` (random) | 0 | `file is not a database` |
| `spike-plain.db` (control, no key) | `SQLite format 3\0` | 1 | Read the marker |

File mode on device: `-rw-------`, owner = app UID; directory `drwxrwx--x`.

## Findings that shape the implementation

1. **Encryption is real, not assumed.** Verified at runtime (`cipher_version`) and
   on disk (no plaintext, no SQLite header).
2. **Use the raw key format.** `x'<64 hex chars>'` is accepted and avoids KDF
   cost on every open.
3. **Omit `encryptionKey` instead of passing `undefined`.** `open({ name,
   encryptionKey: undefined })` throws `Value is undefined, expected a String`.
4. **A wrong key surfaces on the first query, not on `open()`.** Startup must run
   a probe query (`SELECT count(*) FROM sqlite_master`) to detect a bad key.
5. **An unencrypted file can be created by mistake** if the key is omitted. The
   database module must refuse to open without a key.

## Not covered by the spike

- Release build (covered in Phase 1 Step 8).
- Older Android versions (minSdk 24) — only API 37 emulator available.
- Real devices with StrongBox.
