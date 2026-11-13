import {
  Attachment,
  AttachmentMimeType,
  DocumentItem,
  Item,
  LoyaltyCard,
  Reminder,
} from './types';
import { strings } from '../i18n/strings';
import { nextDue, repeatLabel } from '../reminders/reminderSchedule';

// Formatting is done by hand so output is identical on every device,
// regardless of system locale: names and word order come from the app
// language's strings (src/i18n), never from the device.

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
  return strings().dates.time(date.getHours(), date.getMinutes());
}

/** "12 Oct 2026", or "12 Oct" within the current year. */
export function formatDate(date: Date, now = new Date()): string {
  const { dayMonth, dayMonthYear } = strings().dates;
  return date.getFullYear() === now.getFullYear()
    ? dayMonth(date.getDate(), date.getMonth())
    : dayMonthYear(date.getDate(), date.getMonth(), date.getFullYear());
}

/** "12 Oct 2026" */
export function formatFullDate(date: Date): string {
  return strings().dates.dayMonthYear(
    date.getDate(),
    date.getMonth(),
    date.getFullYear(),
  );
}

/** "Thursday, 30 October" */
export function formatLongToday(now = new Date()): string {
  return strings().dates.longDate(now.getDay(), now.getDate(), now.getMonth());
}

/** "Today, 09:00", "Tomorrow, 18:30", "Mon, 09:00", "12 Nov, 09:00" */
export function formatDue(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  const t = strings().dates;
  let day: string;
  if (diff === 0) {
    day = t.today;
  } else if (diff === 1) {
    day = t.tomorrow;
  } else if (diff === -1) {
    day = t.yesterday;
  } else if (diff > 1 && diff < 7) {
    day = t.weekdaysShort[date.getDay()];
  } else {
    day = formatDate(date, now);
  }
  return t.dayAndTime(day, formatTime(date));
}

/** "Just now", "2 h ago", "Yesterday", "12 Oct" */
export function formatRelative(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const t = strings().dates;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return t.justNow;
  }
  if (minutes < 60) {
    return t.minutesAgo(minutes);
  }
  const diff = dayDiff(date, now);
  if (diff === 0) {
    return t.hoursAgo(Math.floor(minutes / 60));
  }
  if (diff === -1) {
    return t.yesterday;
  }
  return formatDate(date, now);
}

/** "Edited just now", "Edited yesterday", "Edited 12 Oct" */
export function formatEdited(iso: string, now = new Date()): string {
  const t = strings().dates;
  const relative = formatRelative(iso, now);
  return relative === t.justNow
    ? t.editedJustNow
    : relative === t.yesterday
    ? t.editedYesterday
    : t.edited(relative);
}

export { isOverdue, repeatLabel } from '../reminders/reminderSchedule';

const currencySymbols: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export function formatAmount(amount: number, currency: string): string {
  const symbol = currencySymbols[currency];
  const { decimal, group } = strings().numbers;
  const [whole, cents] = amount.toFixed(2).split('.');
  const value = `${whole.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    group,
  )}${decimal}${cents}`;
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

export function formatFileSize(sizeBytes: number): string {
  const kb = sizeBytes === 0 ? 0 : Math.max(1, Math.round(sizeBytes / 1024));
  const t = strings().numbers;
  return kb >= 1024
    ? `${(kb / 1024).toFixed(1).replace('.', t.decimal)} ${t.mb}`
    : `${kb} ${t.kb}`;
}

const attachmentTypeKeys = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
} as const satisfies Record<AttachmentMimeType, string>;

/** "PDF · 1.2 MB" */
export function describeAttachment(
  a: Pick<Attachment, 'mimeType' | 'sizeBytes'>,
): string {
  const types = strings().attachmentTypes;
  const key = attachmentTypeKeys[a.mimeType] as keyof typeof types | undefined;
  return `${types[key ?? 'file']} · ${formatFileSize(a.sizeBytes)}`;
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
  const t = strings();
  const parts = [t.documentKinds[doc.kind]];
  const expires = doc.expiresOn ? parseIsoDate(doc.expiresOn) : null;
  if (expires) {
    const label =
      expires < now
        ? t.summary.expired
        : doc.kind === 'warranty'
        ? t.summary.until
        : t.summary.expires;
    parts.push(label(formatFullDate(expires)));
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
  const number = maskCardNumber(card.cardNumber);
  return card.issuer ? `${card.issuer} · ${number}` : number;
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
