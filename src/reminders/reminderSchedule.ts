// Pure helpers connecting the Reminder model to recurrence rules. Used by the
// UI (labels, next due, overdue) and the scheduler (what to arm).
import type { Reminder, ReminderRepeat } from '../data/types';
import {
  deviceZone,
  formatLocalDateTime,
  localDateTimeOf,
  nextOccurrence,
  parseLocalDateTime,
  RecurrenceSpec,
  Zone,
} from './recurrence';

/** Interval choices offered in the editor (minutes). */
export const INTERVAL_PRESETS = [60, 120, 240, 480, 720] as const;

export const repeatLabels: Record<ReminderRepeat, string> = {
  once: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
  interval: 'At an interval',
};

export function intervalLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
  }
  return `Every ${minutes} minutes`;
}

/** "Every day", "Every 4 hours", … */
export function repeatLabel(reminder: Reminder): string {
  return reminder.repeat === 'interval' && reminder.intervalMinutes
    ? intervalLabel(reminder.intervalMinutes)
    : repeatLabels[reminder.repeat];
}

export function specOf(reminder: Reminder): RecurrenceSpec | null {
  const localStart = parseLocalDateTime(reminder.localStart);
  const startAt = Date.parse(reminder.dueAt);
  if (!localStart || Number.isNaN(startAt)) {
    return null;
  }
  return {
    mode: reminder.repeat,
    startAt,
    localStart,
    intervalMinutes: reminder.intervalMinutes,
  };
}

/**
 * When the reminder is next due, for display and sorting.
 * ONCE: its time (even if past, so it can show as overdue).
 * Repeating: the next occurrence after `now` (the start, if in the future).
 */
export function nextDue(
  reminder: Reminder,
  now: number = Date.now(),
  zone: Zone = deviceZone,
): number | null {
  if (reminder.repeat === 'once') {
    const t = Date.parse(reminder.dueAt);
    return Number.isNaN(t) ? null : t;
  }
  const spec = specOf(reminder);
  return spec ? nextOccurrence(spec, now - 1, zone) : null;
}

/** The next time a notification should fire, or null if nothing is due. */
export function nextFire(
  reminder: Reminder,
  now: number = Date.now(),
  zone: Zone = deviceZone,
): number | null {
  if (reminder.completed) {
    return null;
  }
  const spec = specOf(reminder);
  return spec ? nextOccurrence(spec, now, zone) : null;
}

/** Only a ONCE reminder whose time has passed can be overdue. */
export function isOverdue(reminder: Reminder, now: number = Date.now()) {
  return (
    !reminder.completed &&
    reminder.repeat === 'once' &&
    Date.parse(reminder.dueAt) < now
  );
}

/** Sets both the instant and the floating local start from a local time. */
export function withStart(
  reminder: Reminder,
  instant: number,
  zone: Zone = deviceZone,
): Reminder {
  return {
    ...reminder,
    dueAt: new Date(instant).toISOString(),
    localStart: formatLocalDateTime(localDateTimeOf(instant, zone)),
  };
}
