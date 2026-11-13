/**
 * Russian and Serbian plural forms: `one` for 1, 21, 31… (not 11), `few` for
 * 2–4, 22–24… (not 12–14), `many` for everything else (0, 5–20, 25…).
 */
export function slavic(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}
