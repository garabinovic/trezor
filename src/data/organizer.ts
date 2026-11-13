// Pure organizer rules shared by screens: per-category filters and sort
// orders, and the Home overview. Kept out of components so they can be tested.
import { nextDue } from '../reminders/reminderSchedule';
import { strings, Strings } from '../i18n/strings';
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

/** A key of the app language's `filters` strings. */
export type FilterText = keyof Strings['filters'];

export interface ItemFilter<T extends ItemType> {
  value: string;
  label: FilterText;
  predicate: (item: ItemOfType<T>) => boolean;
  /** Shown when this filter has no matches but the category isn't empty. */
  emptyMessage: FilterText | null;
}

export const reminderFilters: ItemFilter<'reminder'>[] = [
  {
    value: 'upcoming',
    label: 'upcoming',
    predicate: r => !r.completed,
    emptyMessage: 'upcomingEmpty',
  },
  {
    value: 'done',
    label: 'done',
    predicate: r => r.completed,
    emptyMessage: 'doneEmpty',
  },
];

/**
 * One filter per stored document kind (the schema allows exactly these four,
 * so nothing falls outside them).
 */
export const documentFilters: ItemFilter<'document'>[] = [
  { value: 'all', label: 'all', predicate: () => true, emptyMessage: null },
  {
    value: 'receipt',
    label: 'receipts',
    predicate: d => d.kind === 'receipt',
    emptyMessage: 'receiptsEmpty',
  },
  {
    value: 'warranty',
    label: 'warranties',
    predicate: d => d.kind === 'warranty',
    emptyMessage: 'warrantiesEmpty',
  },
  {
    value: 'image',
    label: 'images',
    predicate: d => d.kind === 'image',
    emptyMessage: 'imagesEmpty',
  },
  {
    value: 'document',
    label: 'files',
    predicate: d => d.kind === 'document',
    emptyMessage: 'filesEmpty',
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
  const t = strings().counts;
  return open === 0 ? t.nothingDue : t.upcoming(open);
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
