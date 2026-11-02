// Runs the shared fixtures (test-fixtures/recurrence.txt), also used by the
// Kotlin unit tests, so both implementations agree.
import {
  formatLocalDateTime,
  LocalDateTime,
  Zone,
  localToInstant,
  nextOccurrence,
  parseLocalDateTime,
  RecurrenceMode,
} from '../../src/reminders/recurrence';

declare const __dirname: string;
const fs = require('fs');
const path = require('path');

interface Case {
  line: number;
  tz: string;
  mode: RecurrenceMode;
  localStart: string;
  startAt: string;
  interval: string;
  after: string;
  expected: string;
}

const cases: Case[] = fs
  .readFileSync(
    path.join(__dirname, '../../test-fixtures/recurrence.txt'),
    'utf8',
  )
  .split('\n')
  .map((text: string, i: number) => ({ text: text.trim(), line: i + 1 }))
  .filter(({ text }: { text: string }) => text && !text.startsWith('#'))
  .map(({ text, line }: { text: string; line: number }) => {
    const [tz, mode, localStart, startAt, interval, after, expected] = text
      .split('|')
      .map(p => p.trim());
    return {
      line,
      tz,
      mode: mode as RecurrenceMode,
      localStart,
      startAt,
      interval,
      after,
      expected,
    };
  });

/** Any IANA zone via Intl, independent of the machine's own zone. */
function zoneOf(timeZone: string): Zone {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  return {
    localOf(t): LocalDateTime {
      const parts = Object.fromEntries(
        format.formatToParts(new Date(t)).map(p => [p.type, p.value]),
      );
      return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
      };
    },
  };
}

const fallbackLocal = parseLocalDateTime('2000-01-01T00:00')!;

test('fixture file has cases', () => {
  expect(cases.length).toBeGreaterThan(25);
});

test.each(cases.map(c => [`line ${c.line}: ${c.tz} ${c.mode}`, c] as const))(
  '%s',
  (_name, c) => {
    const next = nextOccurrence(
      {
        mode: c.mode,
        startAt: c.startAt === '-' ? 0 : Date.parse(c.startAt),
        localStart:
          c.localStart === '-'
            ? fallbackLocal
            : parseLocalDateTime(c.localStart)!,
        intervalMinutes: c.interval === '-' ? null : Number(c.interval),
      },
      Date.parse(c.after),
      zoneOf(c.tz),
    );
    expect(next === null ? '-' : new Date(next).toISOString()).toBe(
      c.expected === '-' ? '-' : new Date(c.expected).toISOString(),
    );
  },
);

describe('local time helpers', () => {
  test('parse/format round-trip and reject invalid dates', () => {
    expect(formatLocalDateTime(parseLocalDateTime('2026-02-28T07:05')!)).toBe(
      '2026-02-28T07:05',
    );
    for (const bad of [
      '2026-02-29T10:00',
      '2026-13-01T10:00',
      '2026-01-01T24:00',
      '2026-01-01 10:00',
      '',
    ]) {
      expect(parseLocalDateTime(bad)).toBeNull();
    }
  });

  test('localToInstant picks the earlier of two identical wall times', () => {
    expect(
      new Date(
        localToInstant(
          parseLocalDateTime('2026-10-25T02:30')!,
          zoneOf('Europe/Belgrade'),
        ),
      ).toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
  });

  test('invalid intervals have no occurrence', () => {
    for (const minutes of [null, 0, 14, 30 * 24 * 60 + 1]) {
      expect(
        nextOccurrence(
          {
            mode: 'interval',
            startAt: 0,
            localStart: fallbackLocal,
            intervalMinutes: minutes,
          },
          1,
        ),
      ).toBeNull();
    }
  });
});
