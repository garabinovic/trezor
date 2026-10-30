import { matchesSearch, normalizeSearchTerm } from '../data/search';
import type { Item } from '../data/types';

/**
 * Persistence boundary for items. The UI never sees SQL; ItemsProvider talks
 * to this interface only.
 */
export interface ItemRepository {
  /** Every item, most recently updated first. */
  listAll(): Promise<Item[]>;
  /** Inserts or replaces an item. An item's type can never change. */
  save(item: Item): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Items whose text fields contain `term` (case-insensitive, Unicode-aware),
   * most recently updated first. An empty term returns nothing.
   */
  search(term: string): Promise<Item[]>;
}

/** Shared by implementations: filter already-loaded items by a search term. */
export function filterBySearch(items: Item[], term: string): Item[] {
  const normalized = normalizeSearchTerm(term);
  return normalized ? items.filter(i => matchesSearch(i, normalized)) : [];
}

/** Holds items in memory only. Used for development sample data and tests. */
export class InMemoryItemRepository implements ItemRepository {
  private items: Item[];

  constructor(initial: Item[] = []) {
    this.items = initial.map(i => ({ ...i }));
  }

  async listAll(): Promise<Item[]> {
    return [...this.items]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(i => ({ ...i }));
  }

  async save(item: Item): Promise<void> {
    const existing = this.items.find(i => i.id === item.id);
    if (existing && existing.type !== item.type) {
      throw new Error(`Item ${item.id} cannot change type`);
    }
    this.items = existing
      ? this.items.map(i =>
          i.id === item.id ? { ...item, createdAt: existing.createdAt } : i,
        )
      : [{ ...item }, ...this.items];
  }

  async delete(id: string): Promise<void> {
    this.items = this.items.filter(i => i.id !== id);
  }

  async search(term: string): Promise<Item[]> {
    return filterBySearch(await this.listAll(), term);
  }
}
