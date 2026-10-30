export type ItemType = 'note' | 'reminder' | 'card' | 'document';

interface BaseItem {
  id: string;
  title: string;
  pinned: boolean;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface Note extends BaseItem {
  type: 'note';
  body: string;
}

export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Reminder extends BaseItem {
  type: 'reminder';
  /** ISO 8601 */
  dueAt: string;
  repeat: ReminderRepeat;
  notes: string;
  completed: boolean;
}

export type CardCodeFormat = 'barcode' | 'qr';

export interface LoyaltyCard extends BaseItem {
  type: 'card';
  cardNumber: string;
  codeFormat: CardCodeFormat;
  holderName: string;
  notes: string;
}

export type DocumentKind = 'receipt' | 'warranty' | 'image' | 'document';

export interface Attachment {
  fileName: string;
  sizeKb: number;
}

export interface DocumentItem extends BaseItem {
  type: 'document';
  kind: DocumentKind;
  merchant: string;
  /** ISO date (YYYY-MM-DD), purchase or issue date. */
  date: string | null;
  /** ISO date (YYYY-MM-DD), warranty end. */
  expiresOn: string | null;
  amount: number | null;
  currency: string;
  notes: string;
  attachment: Attachment | null;
}

export type Item = Note | Reminder | LoyaltyCard | DocumentItem;

export type ItemOfType<T extends ItemType> = Extract<Item, { type: T }>;
