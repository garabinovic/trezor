import { DocumentItem, Item, LoyaltyCard, Reminder } from './types';
import { documentKinds } from './categories';
import { nextDue, repeatLabel } from '../reminders/reminderSchedule';

// Formatting is done by hand so output is identical on every device,
// regardless of system locale. The UI is English-only.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function dayDiff(date: Date, now: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "12 Oct 2026", or "12 Oct" within the current year. */
export function formatDate(date: Date, now = new Date()): string {
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? base
    : `${base} ${date.getFullYear()}`;
}

/** "12 Oct 2026" */
export function formatFullDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Thursday, 30 October" */
export function formatLongToday(now = new Date()): string {
  return `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${
    MONTHS_LONG[now.getMonth()]
  }`;
}

/** "Today, 09:00", "Tomorrow, 18:30", "Mon, 09:00", "12 Nov, 09:00" */
export function formatDue(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  let day: string;
  if (diff === 0) {
    day = 'Today';
  } else if (diff === 1) {
    day = 'Tomorrow';
  } else if (diff === -1) {
    day = 'Yesterday';
  } else if (diff > 1 && diff < 7) {
    day = WEEKDAYS[date.getDay()].slice(0, 3);
  } else {
    day = formatDate(date, now);
  }
  return `${day}, ${formatTime(date)}`;
}

/** "Just now", "2 h ago", "Yesterday", "12 Oct" */
export function formatRelative(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const diff = dayDiff(date, now);
  if (diff === 0) {
    return `${Math.floor(minutes / 60)} h ago`;
  }
  if (diff === -1) {
    return 'Yesterday';
  }
  return formatDate(date, now);
}

/** "Edited just now", "Edited yesterday", "Edited 12 Oct" */
export function formatEdited(iso: string, now = new Date()): string {
  const relative = formatRelative(iso, now);
  return relative === 'Just now' || relative === 'Yesterday'
    ? `Edited ${relative.toLowerCase()}`
    : `Edited ${relative}`;
}

export {
  isOverdue,
  repeatLabel,
  repeatLabels,
} from '../reminders/reminderSchedule';

const currencySymbols: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export function formatAmount(amount: number, currency: string): string {
  const symbol = currencySymbols[currency];
  const value = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

/** Groups digits in fours for reading aloud or typing at a till. */
export function formatCardNumber(cardNumber: string): string {
  return cardNumber.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** "•••• 4821" */
export function maskCardNumber(cardNumber: string): string {
  const digits = cardNumber.replace(/\s+/g, '');
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
}

export function formatFileSize(sizeKb: number): string {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

/** Parses a strict YYYY-MM-DD string; returns null when invalid. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

function documentSummary(doc: DocumentItem, now: Date): string {
  const parts = [documentKinds[doc.kind].label];
  const expires = doc.expiresOn ? parseIsoDate(doc.expiresOn) : null;
  if (expires) {
    const label =
      expires < now ? 'Expired' : doc.kind === 'warranty' ? 'Until' : 'Expires';
    parts.push(`${label} ${formatFullDate(expires)}`);
  } else if (doc.date) {
    const date = parseIsoDate(doc.date);
    if (date) {
      parts.push(formatDate(date, now));
    }
  }
  if (doc.amount != null) {
    parts.push(formatAmount(doc.amount, doc.currency));
  }
  return parts.join(' · ');
}

function reminderSummary(reminder: Reminder, now: Date): string {
  const next = nextDue(reminder, now.getTime());
  const due = next === null ? '' : formatDue(new Date(next).toISOString(), now);
  return reminder.repeat === 'once'
    ? due
    : [due, repeatLabel(reminder)].filter(Boolean).join(' · ');
}

function cardSummary(card: LoyaltyCard): string {
  return maskCardNumber(card.cardNumber);
}

/** One-line supporting text for an item in any list. */
export function itemSummary(item: Item, now = new Date()): string {
  switch (item.type) {
    case 'note':
      return item.body
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join(' · ');
    case 'reminder':
      return reminderSummary(item, now);
    case 'card':
      return cardSummary(item);
    case 'document':
      return documentSummary(item, now);
  }
}
