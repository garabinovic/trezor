import React from 'react';
import { sortNotes } from '../data/organizer';
import { CategoryScreen } from './shared/CategoryScreen';

export function NotesScreen() {
  return <CategoryScreen type="note" sort={sortNotes} />;
}
