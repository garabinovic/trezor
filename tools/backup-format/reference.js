/* eslint-env node */
/* eslint-disable no-bitwise -- byte-level reference code */
/* global BigInt */
// Independent reference implementation of TZBK v1 and TZA v1 (Phase 6 spec
// v2.4 §3, Annex A), for test vectors only. It shares no code with the app:
// Node's crypto (OpenSSL) here, BouncyCastle and javax.crypto in Kotlin.
// Never used at runtime.
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const CHUNK = 65536;
const TAG = 16;
const HEADER_BYTES = 128;
const TYPE = { manifest: 0x01, database: 0x02, attachment: 0x03 };

const u8 = n => Buffer.from([n & 0xff]);
const u16 = n => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = n => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u64 = n => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};

/** Deterministic test plaintext: byte i = (i * 31 + seed) mod 256. */
function pattern(length, seed = 7) {
  const b = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    b[i] = (i * 31 + seed) & 0xff;
  }
  return b;
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

function crc32(bytes) {
  return zlib.crc32(bytes) >>> 0;
}

// --- Header (§3.1–3.4) ---------------------------------------------------------

function headerBytes(h, { crc = true } = {}) {
  const b = Buffer.concat([
    Buffer.from('TZBK', 'ascii'),
    u16(1),
    u16(HEADER_BYTES),
    u8(0x01),
    u8(0x01),
    u32(h.m),
    u32(h.t),
    u8(h.p),
    h.salt,
    h.backupId,
    u32(CHUNK),
    h.noncePrefix,
    h.wrapIv,
    h.wrappedBmk ?? Buffer.alloc(48),
    Buffer.alloc(4),
    Buffer.alloc(2),
  ]);
  if (b.length !== HEADER_BYTES) {
    throw new Error('header length');
  }
  if (crc) {
    b.writeUInt32BE(crc32(b), 122);
  }
  return b;
}

/** Header with the CRC (and optionally the wrapped BMK) zeroed. */
function zeroed(header, { wrapped }) {
  const b = Buffer.from(header);
  b.fill(0, 122, 126);
  if (wrapped) {
    b.fill(0, 74, 122);
  }
  return b;
}

function kek(passwordUtf8, h) {
  return crypto.argon2Sync('argon2id', {
    message: passwordUtf8,
    nonce: h.salt,
    parallelism: h.p,
    tagLength: 32,
    memory: h.m,
    passes: h.t,
  });
}

function gcm(key, iv, aad, plaintext) {
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  c.setAAD(aad);
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function ungcm(key, iv, aad, sealed) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([
    d.update(sealed.subarray(0, sealed.length - TAG)),
    d.final(),
  ]);
}

/** Header with the BMK wrapped under KEK, AAD = canonical header. */
function sealedHeader(h, kekBytes, bmk) {
  const canonical = headerBytes(
    { ...h, wrappedBmk: Buffer.alloc(48) },
    { crc: false },
  );
  const wrappedBmk = gcm(kekBytes, h.wrapIv, canonical, bmk);
  return headerBytes({ ...h, wrappedBmk });
}

// --- Keys (§3.5) ---------------------------------------------------------------

function hkdf(ikm, salt, info) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32));
}

const sectionInfo = (type, ordinal) =>
  Buffer.concat([
    Buffer.from('TZBK-SECTION-v1', 'ascii'),
    u8(type),
    u32(ordinal),
  ]);

function keys(bmk, backupId) {
  return {
    section: (type, ordinal) => hkdf(bmk, backupId, sectionInfo(type, ordinal)),
    attachmentWrap: hkdf(
      bmk,
      backupId,
      Buffer.from('trezor.backup.v1.attachment-wrap', 'ascii'),
    ),
    mac: hkdf(bmk, backupId, Buffer.from('trezor.backup.v1.mac', 'ascii')),
    sqlcipher: hkdf(
      bmk,
      backupId,
      Buffer.from('trezor.backup.v1.sqlcipher', 'ascii'),
    ),
  };
}

// --- Sections (§3.6) -----------------------------------------------------------

const chunkCount = p => Math.max(1, Math.ceil(p / CHUNK));
const ciphertextLength = p => p + TAG * chunkCount(p);

const nonce = (prefix, i, final) =>
  Buffer.concat([prefix, u32(i), u8(final ? 1 : 0)]);

const aad = (backupId, type, ordinal, prefix, p, i, final) =>
  Buffer.concat([
    backupId,
    u8(type),
    u32(ordinal),
    u32(CHUNK),
    prefix,
    u64(p),
    u32(i),
    u8(final ? 1 : 0),
  ]);

function encryptSection(key, backupId, prefix, type, ordinal, plaintext) {
  const p = plaintext.length;
  const n = chunkCount(p);
  const out = [];
  for (let i = 0; i < n; i++) {
    const final = i === n - 1;
    const chunk = plaintext.subarray(i * CHUNK, Math.min(p, (i + 1) * CHUNK));
    out.push(
      gcm(
        key,
        nonce(prefix, i, final),
        aad(backupId, type, ordinal, prefix, p, i, final),
        chunk,
      ),
    );
  }
  return Buffer.concat(out);
}

const framing = (length, type, ordinal) =>
  Buffer.concat([u64(length), u8(type), u32(ordinal)]);

// --- Manifest canonical writer (§3.8): JSON.stringify of fields in order -------

function canonicalManifest(m) {
  const ordered = {
    format: m.format,
    manifestVersion: m.manifestVersion,
    createdAt: m.createdAt,
    app: {
      platform: m.app.platform,
      versionName: m.app.versionName,
      versionCode: m.app.versionCode,
    },
    schemaVersion: m.schemaVersion,
    database: { sizeBytes: m.database.sizeBytes, sha256: m.database.sha256 },
    attachments: m.attachments.map(a => ({
      ordinal: a.ordinal,
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      formatVersion: a.formatVersion,
      tzaSizeBytes: a.tzaSizeBytes,
    })),
  };
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

// --- TZA v1 (Annex A) -----------------------------------------------------------

const tzaSize = q => 76 + q + TAG * chunkCount(q);

const tzaWrapAad = id => Buffer.from(`trezor.attachment-dek|1|${id}`, 'utf8');
const tzaBodyAad = (id, prefix) =>
  Buffer.concat([
    Buffer.from(`trezor.attachment|1|${id}|${CHUNK}|`, 'utf8'),
    prefix,
  ]);

function tzaHeader(wrapIv, wrappedDek, prefix) {
  return Buffer.concat([
    Buffer.from('TZA1', 'ascii'),
    u8(1),
    u32(CHUNK),
    wrapIv,
    wrappedDek,
    prefix,
  ]);
}

function tzaEncrypt({ id, key, dek, wrapIv, prefix, plaintext }) {
  const wrappedDek = gcm(key, wrapIv, tzaWrapAad(id), dek);
  const n = chunkCount(plaintext.length);
  const body = [];
  for (let i = 0; i < n; i++) {
    const final = i === n - 1;
    const chunk = plaintext.subarray(
      i * CHUNK,
      Math.min(plaintext.length, (i + 1) * CHUNK),
    );
    body.push(gcm(dek, nonce(prefix, i, final), tzaBodyAad(id, prefix), chunk));
  }
  return Buffer.concat([tzaHeader(wrapIv, wrappedDek, prefix), ...body]);
}

function tzaRewrap(file, id, oldKey, newKey, newWrapIv) {
  const wrapIv = file.subarray(9, 21);
  const wrapped = file.subarray(21, 69);
  const prefix = file.subarray(69, 76);
  const dek = ungcm(oldKey, wrapIv, tzaWrapAad(id), wrapped);
  return Buffer.concat([
    tzaHeader(newWrapIv, gcm(newKey, newWrapIv, tzaWrapAad(id), dek), prefix),
    file.subarray(76),
  ]);
}

// --- Complete file (§3) -------------------------------------------------------

function backupFile({
  passwordUtf8,
  header,
  bmk,
  manifest,
  database,
  attachments,
}) {
  const k = keys(bmk, header.backupId);
  const head = sealedHeader(header, kek(passwordUtf8, header), bmk);
  const parts = [head];
  const mac = crypto.createHmac('sha256', k.mac);
  mac.update(zeroed(head, { wrapped: false }));
  const add = (type, ordinal, plaintext) => {
    const ct = encryptSection(
      k.section(type, ordinal),
      header.backupId,
      header.noncePrefix,
      type,
      ordinal,
      plaintext,
    );
    const f = framing(ct.length, type, ordinal);
    mac.update(f);
    mac.update(ct);
    parts.push(f, ct);
  };
  add(TYPE.manifest, 0, canonicalManifest(manifest));
  add(TYPE.database, 0, database);
  attachments.forEach((a, i) => add(TYPE.attachment, i, a));
  parts.push(mac.digest());
  return Buffer.concat(parts);
}

module.exports = {
  CHUNK,
  TYPE,
  pattern,
  sha256,
  crc32,
  headerBytes,
  zeroed,
  kek,
  gcm,
  sealedHeader,
  hkdf,
  sectionInfo,
  keys,
  chunkCount,
  ciphertextLength,
  nonce,
  aad,
  encryptSection,
  framing,
  canonicalManifest,
  tzaSize,
  tzaWrapAad,
  tzaBodyAad,
  tzaEncrypt,
  tzaRewrap,
  backupFile,
};
