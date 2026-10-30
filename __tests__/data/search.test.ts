import { createSampleItems } from '../../src/data/sampleData';
import {
  matchesSearch,
  normalizeSearchTerm,
  searchableText,
} from '../../src/data/search';
import type { Item } from '../../src/data/types';

const items = createSampleItems(new Date('2026-10-30T12:00:00Z'));
const find = (id: string) => items.find(i => i.id === id) as Item;
const matches = (id: string, term: string) =>
  matchesSearch(find(id), normalizeSearchTerm(term));

describe('search matching', () => {
  test('notes match title and body', () => {
    expect(matches('n1', 'cottage')).toBe(true);
    expect(matches('n1', 'pinecone')).toBe(true);
  });

  test('reminders match title and description', () => {
    expect(matches('r2', 'dentist')).toBe(true);
    expect(matches('r2', 'insurance card')).toBe(true);
  });

  test('cards match name, number, holder and notes', () => {
    expect(matches('c1', 'greenleaf')).toBe(true);
    expect(matches('c1', '3381')).toBe(true);
    expect(matches('c1', 'jordan')).toBe(true);
    expect(matches('c1', 'january')).toBe(true);
  });

  test('documents match title, issuer, notes, type label and file name', () => {
    expect(matches('d1', 'washing')).toBe(true);
    expect(matches('d1', 'hometech')).toBe(true);
    expect(matches('d1', 'wm-8400')).toBe(true);
    expect(matches('d1', 'warranty')).toBe(true);
    expect(matches('d1', 'warranty-wm8400.pdf')).toBe(true);
  });

  test('is case-insensitive beyond ASCII and trims the term', () => {
    const note: Item = {
      id: 'x',
      type: 'note',
      title: 'Šifra za Ž garažu',
      body: 'ĐAČKI dom',
      pinned: false,
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z',
    };
    expect(matchesSearch(note, normalizeSearchTerm('  šifra '))).toBe(true);
    expect(matchesSearch(note, normalizeSearchTerm('GARAŽU'))).toBe(true);
    expect(matchesSearch(note, normalizeSearchTerm('đački'))).toBe(true);
  });

  test('an empty term matches nothing', () => {
    expect(matchesSearch(find('n1'), normalizeSearchTerm('   '))).toBe(false);
  });

  test('fields of other types are not searched', () => {
    // A reminder has no card number or merchant; its text is title + notes only.
    expect(searchableText(find('r1'))).toEqual([
      'Pay electricity bill',
      'Reference number is on the last invoice.',
    ]);
  });
});
