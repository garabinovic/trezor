import React from 'react';
import { sortCards } from '../data/organizer';
import { CategoryScreen } from './shared/CategoryScreen';

export function CardsScreen() {
  return <CategoryScreen type="card" sort={sortCards} />;
}
