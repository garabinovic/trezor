import { documentKinds } from './categories';
import { Item } from './types';

/** Every text field a person would expect search to look at, per type. */
export function searchableText(item: Item): string[] {
  switch (item.type) {
    case 'note':
      return [item.title, item.body];
    case 'reminder':
      return [item.title, item.notes];
    case 'card':
      return [item.title, item.cardNumber, item.holderName, item.notes];
    case 'document':
      return [
        item.title,
        item.merchant,
        item.notes,
        documentKinds[item.kind].label,
        item.attachment?.fileName ?? '',
      ];
  }
}

/** Case-insensitive, Unicode-aware ("Š" matches "š"); whitespace-trimmed. */
export function normalizeSearchTerm(term: string): string {
  return term.trim().toLocaleLowerCase();
}

export function matchesSearch(item: Item, normalizedTerm: string): boolean {
  if (!normalizedTerm) {
    return false;
  }
  return searchableText(item).some(text =>
    text.toLocaleLowerCase().includes(normalizedTerm),
  );
}
