/* eslint-env node */
/* eslint-disable no-bitwise -- byte-level reference code */
// Writes the TZBK v1 / TZA v1 test vectors used by the Kotlin tests:
//   node tools/backup-format/make-vectors.js
// Output: android/app/src/test/resources/backup/tzbk-v1-vectors.json
// Every value is computed by reference.js (Node crypto / OpenSSL) from the
// fixed inputs written next to it. The Argon2id entries are also checked with
// libsodium by check-argon2-libsodium.py.
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./reference');

const hex = b => Buffer.from(b).toString('hex');
const fill = (n, v) => Buffer.alloc(n, v);
const seq = (n, start) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (start + i) & 0xff));

const OUT = path.join(
  __dirname,
  '../../android/app/src/test/resources/backup/tzbk-v1-vectors.json',
);

// --- CRC32 (CRC-32/ISO-HDLC) --------------------------------------------------
const crc = [
  {
    input: hex(Buffer.from('123456789', 'ascii')),
    crc: R.crc32(Buffer.from('123456789', 'ascii')),
  },
  { input: '', crc: R.crc32(Buffer.alloc(0)) },
  { input: hex(seq(128, 0)), crc: R.crc32(seq(128, 0)) },
];

// --- Argon2id ------------------------------------------------------------------
const argonCases = [
  { text: 'correct horse battery', salt: fill(16, 7), m: 65536, t: 3, p: 1 },
  // NFC, non-ASCII (precomposed č ć ž š đ).
  { text: 'Lozinka-čćžšđ-2026', salt: seq(16, 0xa0), m: 65536, t: 3, p: 1 },
  { text: 'correct horse battery', salt: fill(16, 7), m: 65536, t: 4, p: 1 },
];
const argon2id = argonCases.map(c => {
  const password = Buffer.from(c.text, 'utf8');
  return {
    passwordText: c.text,
    password: hex(password),
    salt: hex(c.salt),
    m: c.m,
    t: c.t,
    p: c.p,
    kek: hex(R.kek(password, { salt: c.salt, m: c.m, t: c.t, p: c.p })),
  };
});

// --- HKDF: RFC 5869 test case 1 (SHA-256), and the four TZBK key kinds ---------
const rfc5869 = {
  ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
  salt: '000102030405060708090a0b0c',
  info: 'f0f1f2f3f4f5f6f7f8f9',
  length: 42,
  // RFC 5869 A.1, copied from the RFC.
  okm: '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
};
const rfcOkm = require('crypto').hkdfSync(
  'sha256',
  Buffer.from(rfc5869.ikm, 'hex'),
  Buffer.from(rfc5869.salt, 'hex'),
  Buffer.from(rfc5869.info, 'hex'),
  rfc5869.length,
);
if (hex(rfcOkm) !== rfc5869.okm) {
  throw new Error('Node HKDF does not match RFC 5869 A.1');
}
const bmk = seq(32, 0x10);
const backupId = seq(16, 0x40);
const k = R.keys(bmk, backupId);
const keys = {
  bmk: hex(bmk),
  backupId: hex(backupId),
  section: [
    [R.TYPE.manifest, 0],
    [R.TYPE.database, 0],
    [R.TYPE.attachment, 0],
    [R.TYPE.attachment, 1],
    [R.TYPE.attachment, 0xffffffff],
  ].map(([type, ordinal]) => ({
    type,
    ordinal,
    info: hex(R.sectionInfo(type, ordinal)),
    key: hex(k.section(type, ordinal)),
  })),
  attachmentWrap: hex(k.attachmentWrap),
  mac: hex(k.mac),
  sqlcipher: hex(k.sqlcipher),
};

// --- Nonce and AAD -------------------------------------------------------------
const prefix = seq(7, 0x70);
const nonceAad = [
  [R.TYPE.manifest, 0, 0, 0, true],
  [R.TYPE.database, 0, 200000, 1, false],
  [R.TYPE.attachment, 7, 131072, 1, true],
].map(([type, ordinal, p, i, final]) => ({
  backupId: hex(backupId),
  prefix: hex(prefix),
  type,
  ordinal,
  plaintextLength: p,
  index: i,
  final,
  nonce: hex(R.nonce(prefix, i, final)),
  aad: hex(R.aad(backupId, type, ordinal, prefix, p, i, final)),
}));

// --- Sections: chunk boundaries ------------------------------------------------
const sections = [0, 1, 65535, 65536, 65537, 131072, 3 * 65536 + 5].map(
  size => {
    const type = R.TYPE.database;
    const ordinal = 0;
    const key = k.section(type, ordinal);
    const plaintext = R.pattern(size, 9);
    const ct = R.encryptSection(
      key,
      backupId,
      prefix,
      type,
      ordinal,
      plaintext,
    );
    return {
      key: hex(key),
      backupId: hex(backupId),
      prefix: hex(prefix),
      type,
      ordinal,
      plaintextLength: size,
      plaintextSeed: 9,
      ciphertextLength: ct.length,
      sha256: R.sha256(ct),
      hex: size <= 1 ? hex(ct) : undefined,
    };
  },
);

// --- Header with wrapped BMK ---------------------------------------------------
const headerInput = {
  m: 65536,
  t: 3,
  p: 1,
  salt: fill(16, 7),
  backupId,
  noncePrefix: prefix,
  wrapIv: seq(12, 0x30),
};
const kekBytes = R.kek(
  Buffer.from('correct horse battery', 'utf8'),
  headerInput,
);
const header = {
  password: 'correct horse battery',
  m: headerInput.m,
  t: headerInput.t,
  p: headerInput.p,
  salt: hex(headerInput.salt),
  backupId: hex(backupId),
  noncePrefix: hex(prefix),
  wrapIv: hex(headerInput.wrapIv),
  bmk: hex(bmk),
  kek: hex(kekBytes),
  header: hex(R.sealedHeader(headerInput, kekBytes, bmk)),
};

// --- TZA v1 --------------------------------------------------------------------
const tzaKey = seq(32, 0x80);
const tzaNewKey = seq(32, 0xc0);
const tzaId = '01a1a0dd-991f-783c-9531-3fab9ef47901';
const tza = [0, 1, 65535, 65536, 65537, 131072].map(size => {
  const dek = seq(32, 0x20);
  const wrapIv = seq(12, 0x50);
  const tzaPrefix = seq(7, 0x60);
  const plaintext = R.pattern(size, 3);
  const file = R.tzaEncrypt({
    id: tzaId,
    key: tzaKey,
    dek,
    wrapIv,
    prefix: tzaPrefix,
    plaintext,
  });
  const newWrapIv = seq(12, 0x90);
  const moved = R.tzaRewrap(file, tzaId, tzaKey, tzaNewKey, newWrapIv);
  return {
    id: tzaId,
    key: hex(tzaKey),
    dek: hex(dek),
    wrapIv: hex(wrapIv),
    prefix: hex(tzaPrefix),
    plaintextLength: size,
    plaintextSeed: 3,
    tzaSize: R.tzaSize(size),
    fileLength: file.length,
    header: hex(file.subarray(0, 76)),
    wrapAad: hex(R.tzaWrapAad(tzaId)),
    bodyAad: hex(R.tzaBodyAad(tzaId, tzaPrefix)),
    sha256: R.sha256(file),
    rewrap: {
      newKey: hex(tzaNewKey),
      newWrapIv: hex(newWrapIv),
      sha256: R.sha256(moved),
    },
  };
});

// --- Manifest canonical writer -------------------------------------------------
const manifestObject = {
  format: 'trezor-backup-manifest',
  manifestVersion: 1,
  createdAt: 1793000000000,
  app: { platform: 'android', versionName: '1.0', versionCode: 1 },
  schemaVersion: 3,
  database: { sizeBytes: 5000, sha256: R.sha256(R.pattern(5000, 5)) },
  attachments: [],
};
const escapes = {
  ...manifestObject,
  app: {
    platform: 'android',
    versionName: 'q"b\\s/n\nt\tc\u0007d\u007fe\u0085é\u{1f600}',
    versionCode: 2147483647,
  },
};
const manifests = [manifestObject, escapes].map(m => ({
  object: m,
  canonical: hex(R.canonicalManifest(m)),
}));

// --- Complete file (database section = fixed bytes, Annex B §B.3) --------------
const deviceKey = seq(32, 0xd0);
const attachmentSpecs = [
  {
    id: '01a1a0dd-991f-783c-9531-3fab9ef47901',
    fileName: 'scan "1".pdf',
    mimeType: 'application/pdf',
    size: 1000,
    seed: 11,
  },
  {
    id: '01a1a0dd-991f-783c-9531-3fab9ef47902',
    fileName: 'Phóto.jpg',
    mimeType: 'image/jpeg',
    size: 65536,
    seed: 12,
  },
];
const fileAttachments = attachmentSpecs.map((a, i) => {
  const dek = seq(32, 0x01 + i);
  const wrapIv = seq(12, 0x11 + i);
  const tzaPrefix = seq(7, 0x21 + i);
  const plaintext = R.pattern(a.size, a.seed);
  const deviceFile = R.tzaEncrypt({
    id: a.id,
    key: deviceKey,
    dek,
    wrapIv,
    prefix: tzaPrefix,
    plaintext,
  });
  const sectionWrapIv = seq(12, 0x31 + i);
  const section = R.tzaRewrap(
    deviceFile,
    a.id,
    deviceKey,
    k.attachmentWrap,
    sectionWrapIv,
  );
  return {
    spec: {
      ...a,
      dek: hex(dek),
      wrapIv: hex(wrapIv),
      prefix: hex(tzaPrefix),
      sectionWrapIv: hex(sectionWrapIv),
    },
    plaintext,
    section,
  };
});
const fileManifest = {
  ...manifestObject,
  attachments: fileAttachments.map((a, i) => ({
    ordinal: i,
    id: a.spec.id,
    fileName: a.spec.fileName,
    mimeType: a.spec.mimeType,
    sizeBytes: a.spec.size,
    sha256: R.sha256(a.plaintext),
    formatVersion: 1,
    tzaSizeBytes: R.tzaSize(a.spec.size),
  })),
};
const database = R.pattern(5000, 5);
const fileBytes = R.backupFile({
  passwordUtf8: Buffer.from('correct horse battery', 'utf8'),
  header: headerInput,
  bmk,
  manifest: fileManifest,
  database,
  attachments: fileAttachments.map(a => a.section),
});
const file = {
  password: 'correct horse battery',
  header: {
    m: 65536,
    t: 3,
    p: 1,
    salt: header.salt,
    backupId: header.backupId,
    noncePrefix: header.noncePrefix,
    wrapIv: header.wrapIv,
  },
  bmk: hex(bmk),
  deviceAttachmentKey: hex(deviceKey),
  manifest: fileManifest,
  database: { length: database.length, seed: 5 },
  attachments: fileAttachments.map(a => a.spec),
  length: fileBytes.length,
  sha256: R.sha256(fileBytes),
  base64: fileBytes.toString('base64'),
};

const vectors = {
  spec: 'Trezor Phase 6 specification v2.4, TZBK v1 and Annex A (TZA v1)',
  generator: `tools/backup-format/make-vectors.js, Node ${process.version}, OpenSSL ${process.versions.openssl}`,
  crc,
  argon2id,
  rfc5869,
  keys,
  nonceAad,
  sections,
  header,
  tza,
  manifests,
  file,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(vectors, null, 1) + '\n');
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} (${
    fileBytes.length
  }-byte complete file)`,
);
