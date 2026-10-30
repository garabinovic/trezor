import React from 'react';
import { DocumentItem } from '../data';
import { CategoryFilter, CategoryScreen } from './shared/CategoryScreen';

const filters: CategoryFilter<'document'>[] = [
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

const byPinnedThenDate = (a: DocumentItem, b: DocumentItem) =>
  Number(b.pinned) - Number(a.pinned) ||
  (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt);

export function DocumentsScreen() {
  return (
    <CategoryScreen type="document" sort={byPinnedThenDate} filters={filters} />
  );
}
