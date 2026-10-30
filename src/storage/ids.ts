/* eslint-disable no-bitwise -- byte-level UUID layout */

/**
 * UUIDv7 (RFC 9562): 48-bit Unix millisecond timestamp, then 74 random bits.
 * Time-ordered, so ids sort by creation time. `random` must be at least
 * 10 bytes from a cryptographically secure source.
 */
export function uuidv7(now: number, random: Uint8Array): string {
  if (random.length < 10) {
    throw new Error('uuidv7 needs 10 random bytes');
  }
  const bytes = new Uint8Array(16);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | (random[0] & 0x0f); // version 7
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f); // variant 10
  bytes.set(random.subarray(3, 10), 9);

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
