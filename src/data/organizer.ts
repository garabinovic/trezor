// Pure organizer rules shared by screens: per-category filters and sort
// orders, and the Home overview. Kept out of components so they can be tested.
import { nextDue } from '../reminders/reminderSchedule';
import { itemTypes } from './categories';
import {
  DocumentItem,
  Item,
  ItemOfType,
  ItemType,
  LoyaltyCard,
  Note,
  Reminder,
} from './types';

export interface ItemFilter<T extends ItemType> {
  value: string;
  label: string;
  predicate: (item: ItemOfType<T>) => boolean;
  /** Shown when this filter has no matches but the category isn't empty. */
  emptyMessage: string;
}

export const reminderFilters: ItemFilter<'reminder'>[] = [
  {
    value: 'upcoming',
    label: 'Upcoming',
    predicate: r => !r.completed,
    emptyMessage: 'You are all caught up.',
  },
  {
    value: 'done',
    label: 'Done',
    predicate: r => r.completed,
    emptyMessage: 'Completed reminders will appear here.',
  },
];

export const documentFilters: ItemFilter<'document'>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    emptyMessage: '',
  },
  {
    value: 'receipts',
    label: 'Receipts',
    predicate: d => d.kind === 'receipt',
    emptyMessage: 'No receipts saved.',
  },
  {
    value: 'warranties',
    label: 'Warranties',
    predicate: d => d.kind === 'warranty',
    emptyMessage: 'No warranties saved.',
  },
  {
    value: 'other',
    label: 'Other',
    predicate: d => d.kind === 'image' || d.kind === 'document',
    emptyMessage: 'No other documents saved.',
  },
];

const pinnedFirst = (a: Item, b: Item) => Number(b.pinned) - Number(a.pinned);

/** Pinned first, then most recently updated. */
export const sortNotes = (a: Note, b: Note) =>
  pinnedFirst(a, b) || b.updatedAt.localeCompare(a.updatedAt);

const dueKey = (r: Reminder, now: number) =>
  nextDue(r, now) ?? Number.MAX_SAFE_INTEGER;

/**
 * Open reminders by when they're next due (repeating ones by their next
 * occurrence); completed ones most recently updated first.
 */
export const sortReminders = (a: Reminder, b: Reminder, now = Date.now()) =>
  a.completed && b.completed
    ? b.updatedAt.localeCompare(a.updatedAt)
    : dueKey(a, now) - dueKey(b, now);

/** Pinned first, then alphabetical. */
export const sortCards = (a: LoyaltyCard, b: LoyaltyCard) =>
  pinnedFirst(a, b) || a.title.localeCompare(b.title);

/** Pinned first, then by document date (or creation), newest first. */
export const sortDocuments = (a: DocumentItem, b: DocumentItem) =>
  pinnedFirst(a, b) ||
  (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt);

export function reminderCountLabel(reminders: Reminder[]): string {
  const open = reminders.filter(r => !r.completed).length;
  return open === 0 ? 'Nothing due' : `${open} upcoming`;
}

export const COMING_UP_LIMIT = 3;
export const RECENT_LIMIT = 4;

export interface HomeOverview {
  counts: Record<ItemType, number>;
  /** All open reminders, soonest first (Home shows the first few). */
  comingUp: Reminder[];
  pinned: Item[];
  /** Recently updated items not already shown above; reminders excluded. */
  recent: Item[];
}

export function buildHomeOverview(
  items: Item[],
  now: number = Date.now(),
): HomeOverview {
  const counts = Object.fromEntries(
    itemTypes.map(t => [t, items.filter(i => i.type === t).length]),
  ) as Record<ItemType, number>;
  const comingUp = items
    .filter((i): i is Reminder => i.type === 'reminder' && !i.completed)
    .sort((a, b) => dueKey(a, now) - dueKey(b, now));
  const pinned = items.filter(i => i.pinned);
  const shown = new Set<string>([
    ...comingUp.slice(0, COMING_UP_LIMIT).map(i => i.id),
    ...pinned.map(i => i.id),
  ]);
  const recent = items
    .filter(i => !shown.has(i.id) && i.type !== 'reminder')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
  return { counts, comingUp, pinned, recent };
}
