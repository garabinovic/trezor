import { attachmentIdsOf, attachmentProblem } from '../data/attachments';
import { matchesSearch, normalizeSearchTerm } from '../data/search';
import type { Item } from '../data/types';

/**
 * Persistence boundary for items. The UI never sees SQL; ItemsProvider talks
 * to this interface only.
 */
export interface ItemRepository {
  /** Every item, most recently updated first. */
  listAll(): Promise<Item[]>;
  /**
   * Inserts or replaces an item, with its attachment records, atomically. An
   * item's type can never change. Returns the ids of attachments the item no
   * longer has: their files may be deleted once this has resolved.
   */
  save(item: Item): Promise<string[]>;
  /** Deletes an item; returns the ids of its attachments (files to delete). */
  delete(id: string): Promise<string[]>;
  /** Every stored attachment id (startup clean-up of orphan files). */
  listAttachmentIds(): Promise<string[]>;
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

  async save(item: Item): Promise<string[]> {
    const existing = this.items.find(i => i.id === item.id);
    if (existing && existing.type !== item.type) {
      throw new Error(`Item ${item.id} cannot change type`);
    }
    const problem = attachmentProblem(item);
    if (problem) {
      throw new Error(problem);
    }
    const kept = new Set(attachmentIdsOf(item));
    const taken = this.items
      .filter(i => i.id !== item.id)
      .flatMap(attachmentIdsOf);
    if (taken.some(id => kept.has(id))) {
      throw new Error('Attachment belongs to another item');
    }
    this.items = existing
      ? this.items.map(i =>
          i.id === item.id ? { ...item, createdAt: existing.createdAt } : i,
        )
      : [{ ...item }, ...this.items];
    return existing ? attachmentIdsOf(existing).filter(id => !kept.has(id)) : [];
  }

  async delete(id: string): Promise<string[]> {
    const existing = this.items.find(i => i.id === id);
    this.items = this.items.filter(i => i.id !== id);
    return existing ? attachmentIdsOf(existing) : [];
  }

  async listAttachmentIds(): Promise<string[]> {
    return this.items.flatMap(attachmentIdsOf);
  }

  async search(term: string): Promise<Item[]> {
    return filterBySearch(await this.listAll(), term);
  }
}
