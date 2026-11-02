import { itemSummary } from '../../src/data/format';
import {
  buildHomeOverview,
  COMING_UP_LIMIT,
  documentFilters,
  reminderCountLabel,
  reminderFilters,
  RECENT_LIMIT,
  sortCards,
  sortDocuments,
  sortNotes,
  sortReminders,
} from '../../src/data/organizer';
import { createSampleItems } from '../../src/data/sampleData';
import { nextDue } from '../../src/reminders/reminderSchedule';
import type {
  DocumentItem,
  Item,
  LoyaltyCard,
  Note,
  Reminder,
} from '../../src/data/types';

const NOW = new Date('2026-10-30T12:00:00Z');
const all = createSampleItems(NOW);
const ofType = <T extends Item['type']>(t: T) =>
  all.filter(i => i.type === t) as Extract<Item, { type: T }>[];
const filterBy = <T extends { value: string }>(filters: T[], value: string) =>
  filters.find(f => f.value === value)!;

describe('category filters', () => {
  test('reminders split into upcoming and done', () => {
    const reminders = ofType('reminder');
    const upcoming = reminders.filter(
      filterBy(reminderFilters, 'upcoming').predicate,
    );
    const done = reminders.filter(filterBy(reminderFilters, 'done').predicate);
    expect(upcoming.every(r => !r.completed)).toBe(true);
    expect(done.map(r => r.id)).toEqual(['r5']);
    expect(upcoming.length + done.length).toBe(reminders.length);
  });

  test('documents filter by kind; "other" covers images and documents', () => {
    const docs = ofType('document');
    const ids = (value: string) =>
      docs
        .filter(filterBy(documentFilters, value).predicate)
        .map(d => d.id)
        .sort();
    expect(ids('all')).toEqual(docs.map(d => d.id).sort());
    expect(ids('receipts')).toEqual(['d2']);
    expect(ids('warranties')).toEqual(['d1', 'd3']);
    expect(ids('other')).toEqual(['d4', 'd5']);
  });

  test('reminder count label', () => {
    expect(reminderCountLabel(ofType('reminder'))).toBe('4 upcoming');
    expect(reminderCountLabel([])).toBe('Nothing due');
  });
});

describe('sorting', () => {
  test('notes: pinned first, then most recently updated', () => {
    const sorted = [...ofType('note')].sort(sortNotes) as Note[];
    expect(sorted[0].pinned).toBe(true);
    const rest = sorted.slice(1).map(n => n.updatedAt);
    expect(rest).toEqual([...rest].sort().reverse());
  });

  test('reminders: open by next due (repeating ones by next occurrence)', () => {
    const now = NOW.getTime();
    const sorted = [...ofType('reminder')].sort((a, b) =>
      sortReminders(a as Reminder, b as Reminder, now),
    ) as Reminder[];
    const open = sorted
      .filter(r => !r.completed)
      .map(r => nextDue(r, now) as number);
    expect(open).toEqual([...open].sort((a, b) => a - b));
    // The monthly bill was due yesterday; it now sorts by next month.
    const bill = sorted.find(r => r.id === 'r1')!;
    expect(nextDue(bill, now)! > now).toBe(true);
  });

  test('cards: pinned first, then alphabetical', () => {
    const sorted = [...ofType('card')].sort(sortCards) as LoyaltyCard[];
    expect(sorted.map(c => c.title)).toEqual([
      'Greenleaf Market',
      'City Library',
      'Northside Pharmacy',
      'Ridge Fitness',
    ]);
  });

  test('documents: pinned first, then newest document date', () => {
    const sorted = [...ofType('document')].sort(
      sortDocuments,
    ) as DocumentItem[];
    expect(sorted[0].id).toBe('d4'); // pinned
    const dates = sorted.slice(1).map(d => d.date ?? d.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('Home overview', () => {
  test('counts every type from the given items', () => {
    expect(buildHomeOverview(all).counts).toEqual({
      note: 4,
      reminder: 5,
      card: 4,
      document: 5,
    });
  });

  test('coming up lists open reminders by next due, soonest first', () => {
    const now = NOW.getTime();
    const { comingUp } = buildHomeOverview(all, now);
    expect(comingUp.every(r => !r.completed)).toBe(true);
    const due = comingUp.map(r => nextDue(r, now) as number);
    expect(due).toEqual([...due].sort((a, b) => a - b));
  });

  test('pinned and recent sections do not repeat items', () => {
    const { pinned, recent, comingUp } = buildHomeOverview(all);
    expect(pinned.map(i => i.id).sort()).toEqual(['c1', 'd4', 'n1']);
    const shown = new Set([
      ...pinned.map(i => i.id),
      ...comingUp.slice(0, COMING_UP_LIMIT).map(i => i.id),
    ]);
    expect(recent.length).toBeLessThanOrEqual(RECENT_LIMIT);
    expect(recent.some(i => shown.has(i.id))).toBe(false);
    expect(recent.some(i => i.type === 'reminder')).toBe(false);
    const times = recent.map(i => i.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  test('empty data gives zero counts and empty sections', () => {
    expect(buildHomeOverview([])).toEqual({
      counts: { note: 0, reminder: 0, card: 0, document: 0 },
      comingUp: [],
      pinned: [],
      recent: [],
    });
  });
});

describe('document list summary', () => {
  const base: DocumentItem = {
    id: 'd',
    type: 'document',
    kind: 'document',
    title: 'Passport',
    merchant: '',
    date: '2024-05-01',
    expiresOn: '2034-05-01',
    amount: null,
    currency: 'EUR',
    notes: '',
    attachment: null,
    pinned: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };

  test('shows the expiry for any document kind', () => {
    expect(itemSummary(base, NOW)).toBe('Document · Expires 1 May 2034');
    expect(itemSummary({ ...base, kind: 'warranty' }, NOW)).toBe(
      'Warranty · Until 1 May 2034',
    );
    expect(itemSummary({ ...base, expiresOn: '2025-01-01' }, NOW)).toBe(
      'Document · Expired 1 Jan 2025',
    );
  });

  test('falls back to the document date without an expiry', () => {
    expect(itemSummary({ ...base, expiresOn: null }, NOW)).toBe(
      'Document · 1 May 2024',
    );
  });
});
