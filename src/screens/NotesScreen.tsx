import React from 'react';
import { Note } from '../data';
import { CategoryScreen } from './shared/CategoryScreen';

const byPinnedThenRecent = (a: Note, b: Note) =>
  Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

export function NotesScreen() {
  return <CategoryScreen type="note" sort={byPinnedThenRecent} />;
}
