import type { RecurrenceMode } from '../reminders/recurrence';

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

export type ReminderRepeat = RecurrenceMode;

export interface Reminder extends BaseItem {
  type: 'reminder';
  /**
   * ISO 8601 instant. ONCE: when it fires. INTERVAL: the first occurrence
   * (anchor). Calendar modes: the start, as an instant at the time of saving.
   */
  dueAt: string;
  /**
   * Floating local start "YYYY-MM-DDTHH:MM". Calendar modes take their time,
   * weekday and day from it, in the device's current zone.
   */
  localStart: string;
  repeat: ReminderRepeat;
  /** INTERVAL only (minutes); null otherwise. */
  intervalMinutes: number | null;
  /** Description. */
  notes: string;
  completed: boolean;
}

/** Kept in storage; not shown until code scanning exists. */
export type CardCodeFormat = 'barcode' | 'qr';

export type AttachmentMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'application/pdf';

/**
 * Metadata of an encrypted attachment file. The bytes live in the native
 * attachment store under `id`; SQLCipher holds this record.
 */
export interface Attachment {
  /** UUIDv7; also names the encrypted file. Immutable. */
  id: string;
  /** Original display name. */
  fileName: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  /** SHA-256 of the plaintext (hex), checked whenever the file is read. */
  sha256: string;
  /** Encrypted file format version. */
  formatVersion: number;
  /** ISO 8601 */
  createdAt: string;
}

export interface LoyaltyCard extends BaseItem {
  type: 'card';
  /** Store or programme that issued the card. */
  issuer: string;
  cardNumber: string;
  codeFormat: CardCodeFormat;
  holderName: string;
  notes: string;
  /** Photos of the card (images only). */
  frontImage: Attachment | null;
  backImage: Attachment | null;
}

export type DocumentKind = 'receipt' | 'warranty' | 'image' | 'document';

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
  /** In display order; at most MAX_DOCUMENT_ATTACHMENTS. */
  attachments: Attachment[];
}

export type Item = Note | Reminder | LoyaltyCard | DocumentItem;

export type ItemOfType<T extends ItemType> = Extract<Item, { type: T }>;
