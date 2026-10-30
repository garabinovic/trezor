import React from 'react';
import { Reminder } from '../data';
import { CategoryFilter, CategoryScreen } from './shared/CategoryScreen';

const filters: CategoryFilter<'reminder'>[] = [
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

// Open reminders soonest first; completed ones most recent first.
const byDue = (a: Reminder, b: Reminder) =>
  a.completed && b.completed
    ? b.updatedAt.localeCompare(a.updatedAt)
    : a.dueAt.localeCompare(b.dueAt);

const countLabel = (reminders: Reminder[]) => {
  const open = reminders.filter(r => !r.completed).length;
  return open === 0 ? 'Nothing due' : `${open} upcoming`;
};

export function RemindersScreen() {
  return (
    <CategoryScreen
      type="reminder"
      sort={byDue}
      filters={filters}
      countLabel={countLabel}
    />
  );
}
