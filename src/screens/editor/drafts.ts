import { createId, Item, ItemType } from '../../data';

export type FieldErrors = Partial<Record<string, string>>;

function tomorrowAtNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export function createBlankItem(type: ItemType): Item {
  const now = new Date().toISOString();
  const base = {
    id: createId(),
    title: '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  switch (type) {
    case 'note':
      return { ...base, type, body: '' };
    case 'reminder':
      return {
        ...base,
        type,
        dueAt: tomorrowAtNine(),
        repeat: 'none',
        notes: '',
        completed: false,
      };
    case 'card':
      return {
        ...base,
        type,
        cardNumber: '',
        codeFormat: 'barcode',
        holderName: '',
        notes: '',
      };
    case 'document':
      return {
        ...base,
        type,
        kind: 'receipt',
        merchant: '',
        date: null,
        expiresOn: null,
        amount: null,
        currency: 'EUR',
        notes: '',
        attachment: null,
      };
  }
}

export function validate(item: Item): FieldErrors {
  const errors: FieldErrors = {};
  if (!item.title.trim()) {
    errors.title =
      item.type === 'card' ? 'Enter the store or card name.' : 'Enter a title.';
  }
  if (item.type === 'card' && !item.cardNumber.trim()) {
    errors.cardNumber = 'Enter the card number.';
  }
  if (item.type === 'document') {
    if (item.amount != null && Number.isNaN(item.amount)) {
      errors.amount = 'Enter a valid amount, e.g. 24.90';
    }
    if (
      item.kind === 'warranty' &&
      item.date &&
      item.expiresOn &&
      item.expiresOn < item.date
    ) {
      errors.expiresOn = 'Warranty end must be after the purchase date.';
    }
  }
  return errors;
}

/** Trims text fields before saving. */
export function normalize(item: Item): Item {
  const now = new Date().toISOString();
  const trimmed = { ...item, title: item.title.trim(), updatedAt: now };
  switch (trimmed.type) {
    case 'note':
      return { ...trimmed, body: trimmed.body.trim() };
    case 'reminder':
      return { ...trimmed, notes: trimmed.notes.trim() };
    case 'card':
      return {
        ...trimmed,
        cardNumber: trimmed.cardNumber.trim(),
        holderName: trimmed.holderName.trim(),
        notes: trimmed.notes.trim(),
      };
    case 'document':
      return {
        ...trimmed,
        merchant: trimmed.merchant.trim(),
        currency: trimmed.currency.trim().toUpperCase() || 'EUR',
        notes: trimmed.notes.trim(),
        expiresOn: trimmed.kind === 'warranty' ? trimmed.expiresOn : null,
      };
  }
}
