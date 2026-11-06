#!/usr/bin/env python3
"""Checks every Argon2id value in the TZBK v1 vectors with libsodium.

    python3 tools/backup-format/check-argon2-libsodium.py [path/to/libsodium.dylib]

A third, independent implementation (spec v2.4 §13, test 3): libsodium's
crypto_pwhash with crypto_pwhash_ALG_ARGON2ID13 (Argon2id v1.3, p = 1, no
secret, no associated data, 16-byte salt). Exits non-zero on any mismatch.
"""
import ctypes
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(HERE, '../../android/app/src/test/resources/backup/tzbk-v1-vectors.json')


def main():
    lib = sys.argv[1] if len(sys.argv) > 1 else '/opt/homebrew/lib/libsodium.dylib'
    sodium = ctypes.CDLL(lib)
    if sodium.sodium_init() < 0:
        sys.exit('sodium_init failed')
    alg = sodium.crypto_pwhash_alg_argon2id13()
    sodium.sodium_version_string.restype = ctypes.c_char_p
    version = sodium.sodium_version_string().decode()

    def argon2id(password, salt, m_kib, t, p):
        if p != 1 or len(salt) != 16:
            raise ValueError('libsodium supports p = 1 and 16-byte salts only')
        out = ctypes.create_string_buffer(32)
        rc = sodium.crypto_pwhash(
            out, ctypes.c_ulonglong(32), password, ctypes.c_ulonglong(len(password)), salt,
            ctypes.c_ulonglong(t), ctypes.c_size_t(m_kib * 1024), ctypes.c_int(alg))
        if rc != 0:
            raise RuntimeError('crypto_pwhash failed')
        return out.raw.hex()

    with open(VECTORS) as f:
        v = json.load(f)
    cases = [(c['password'], c['salt'], c['m'], c['t'], c['p'], c['kek']) for c in v['argon2id']]
    h = v['header']
    cases.append((h['password'].encode().hex(), h['salt'], h['m'], h['t'], h['p'], h['kek']))
    failed = 0
    for pw, salt, m, t, p, expected in cases:
        got = argon2id(bytes.fromhex(pw), bytes.fromhex(salt), m, t, p)
        status = 'ok' if got == expected else 'MISMATCH'
        failed += status != 'ok'
        print(f'{status}  m={m} t={t} p={p} kek={got}')
    print(f'libsodium {version}: {len(cases) - failed}/{len(cases)} match')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
