// Reminder recurrence rules. Mirrored in Kotlin
// (android/app/src/main/java/com/trezor/app/reminders/Recurrence.kt) so
// background firing computes the same times; both are checked against
// test-fixtures/recurrence.txt. Local times use the device's current zone.

export type RecurrenceMode =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'interval';

export interface LocalDateTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface RecurrenceSpec {
  mode: RecurrenceMode;
  /** UTC ms. ONCE: the moment. INTERVAL: the anchor (first occurrence). */
  startAt: number;
  /** Floating local start. Calendar modes: time, weekday and day come from here. */
  localStart: LocalDateTime;
  /** INTERVAL only. */
  intervalMinutes: number | null;
}

/** Allowed interval range (also enforced by the database). */
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 30 * 24 * 60;

const MINUTE = 60_000;
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocalDateTime(f: LocalDateTime): string {
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(
    f.minute,
  )}`;
}

export function parseLocalDateTime(value: string): LocalDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    return null;
  }
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A time zone: how an instant reads on the local clock. */
export interface Zone {
  localOf(t: number): LocalDateTime;
}

/** The device's current zone (whatever the phone is set to right now). */
export const deviceZone: Zone = {
  localOf(t) {
    const d = new Date(t);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    };
  },
};

/** Local date-time of an instant in the device's zone. */
export function localDateTimeOf(t: number, zone: Zone = deviceZone) {
  return zone.localOf(t);
}

/** Offset of `zone` from UTC at instant t, in ms (minute precision). */
function offsetAt(t: number, zone: Zone): number {
  const f = zone.localOf(t);
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute);
  return wall - (t - (((t % MINUTE) + MINUTE) % MINUTE));
}

const sameLocal = (a: LocalDateTime, b: LocalDateTime) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;

/**
 * Instant of a local wall-clock time in the device's zone.
 * - Time occurs twice (DST ends): the earlier instant.
 * - Time doesn't exist (DST starts): moved forward by the gap
 *   (02:30 on a 02:00→03:00 day becomes 03:30).
 */
export function localToInstant(
  f: LocalDateTime,
  zone: Zone = deviceZone,
): number {
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute);
  const offsets = Array.from(
    new Set([
      offsetAt(wall - DAY, zone),
      offsetAt(wall, zone),
      offsetAt(wall + DAY, zone),
    ]),
  );
  const matches = offsets
    .map(o => wall - o)
    .filter(t => sameLocal(zone.localOf(t), f))
    .sort((a, b) => a - b);
  return matches.length > 0 ? matches[0] : wall - offsetAt(wall - DAY, zone);
}

/** Days since 1970-01-01 for a calendar date (zone-independent). */
const dayNumber = (y: number, m: number, d: number) =>
  Math.floor(Date.UTC(y, m - 1, d) / DAY);

function fromDayNumber(n: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(n * DAY);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

const MAX_STEPS = 16;

/**
 * The first occurrence strictly after `after` (UTC ms), or null if there is
 * none (a ONCE reminder in the past). Never returns an occurrence before the
 * start. Missed occurrences are skipped, not replayed.
 */
export function nextOccurrence(
  spec: RecurrenceSpec,
  after: number,
  zone: Zone = deviceZone,
): number | null {
  const s = spec.localStart;
  const at = (date: { year: number; month: number; day: number }) =>
    localToInstant({ ...date, hour: s.hour, minute: s.minute }, zone);

  switch (spec.mode) {
    case 'once':
      return spec.startAt > after ? spec.startAt : null;

    case 'interval': {
      const minutes = spec.intervalMinutes;
      if (
        minutes == null ||
        minutes < MIN_INTERVAL_MINUTES ||
        minutes > MAX_INTERVAL_MINUTES
      ) {
        return null;
      }
      const step = minutes * MINUTE;
      if (spec.startAt > after) {
        return spec.startAt;
      }
      const k = Math.floor((after - spec.startAt) / step) + 1;
      return spec.startAt + k * step;
    }

    case 'daily':
    case 'weekly': {
      const step = spec.mode === 'daily' ? 1 : 7;
      const startDay = dayNumber(s.year, s.month, s.day);
      const a = zone.localOf(after);
      const afterDay = dayNumber(a.year, a.month, a.day);
      let k = Math.max(0, Math.floor((afterDay - startDay) / step) - 1);
      for (let i = 0; i < MAX_STEPS; i++, k++) {
        const t = at(fromDayNumber(startDay + k * step));
        if (t > after) {
          return t;
        }
      }
      return null;
    }

    case 'monthly': {
      const startIndex = s.year * 12 + (s.month - 1);
      const a = zone.localOf(after);
      let k = Math.max(0, a.year * 12 + (a.month - 1) - startIndex - 1);
      for (let i = 0; i < MAX_STEPS; i++, k++) {
        const index = startIndex + k;
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        const day = Math.min(s.day, daysInMonth(year, month));
        const t = at({ year, month, day });
        if (t > after) {
          return t;
        }
      }
      return null;
    }

    case 'yearly': {
      const a = zone.localOf(after);
      let k = Math.max(0, a.year - s.year - 1);
      for (let i = 0; i < MAX_STEPS; i++, k++) {
        const year = s.year + k;
        const day = Math.min(s.day, daysInMonth(year, s.month));
        const t = at({ year, month: s.month, day });
        if (t > after) {
          return t;
        }
      }
      return null;
    }
  }
}
