import { uuidv7 } from '../../src/storage/ids';

const random = (seed: number) =>
  Uint8Array.from({ length: 10 }, (_, i) => (seed * 31 + i * 17) % 256);

describe('uuidv7', () => {
  test('has RFC 9562 layout, version 7 and variant 10', () => {
    const id = uuidv7(Date.UTC(2026, 9, 30), random(1));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('encodes the millisecond timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 9, 30, 14, 5, 6, 789);
    const id = uuidv7(now, random(2));
    const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(ms).toBe(now);
  });

  test('sorts by creation time', () => {
    const ids = [3, 1, 2].map(t => uuidv7(1_700_000_000_000 + t, random(t)));
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0]]);
  });

  test('different random bytes give different ids', () => {
    expect(uuidv7(1, random(1))).not.toBe(uuidv7(1, random(2)));
  });

  test('rejects too little randomness', () => {
    expect(() => uuidv7(1, new Uint8Array(9))).toThrow();
  });
});
