import React from 'react';
import {
  reminderCountLabel,
  reminderFilters,
  sortReminders,
} from '../data/organizer';
import { CategoryScreen } from './shared/CategoryScreen';

export function RemindersScreen() {
  return (
    <CategoryScreen
      type="reminder"
      sort={sortReminders}
      filters={reminderFilters}
      countLabel={reminderCountLabel}
    />
  );
}
