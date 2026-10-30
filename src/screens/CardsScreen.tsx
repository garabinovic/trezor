import React from 'react';
import { LoyaltyCard } from '../data';
import { CategoryScreen } from './shared/CategoryScreen';

const byPinnedThenName = (a: LoyaltyCard, b: LoyaltyCard) =>
  Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title);

export function CardsScreen() {
  return <CategoryScreen type="card" sort={byPinnedThenName} />;
}
