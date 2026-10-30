import React from 'react';
import { documentFilters, sortDocuments } from '../data/organizer';
import { CategoryScreen } from './shared/CategoryScreen';

export function DocumentsScreen() {
  return (
    <CategoryScreen
      type="document"
      sort={sortDocuments}
      filters={documentFilters}
    />
  );
}
