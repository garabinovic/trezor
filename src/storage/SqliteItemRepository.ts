import type {
  CardCodeFormat,
  DocumentItem,
  DocumentKind,
  Item,
  LoyaltyCard,
  Note,
  Reminder,
  ReminderRepeat,
} from '../data/types';
import { StorageError } from './errors';
import { filterBySearch, ItemRepository } from './ItemRepository';
import { SqlDatabase, SqlExecutor, SqlRow } from './sql';

// Timestamps are stored as integer milliseconds (UTC); the UI model keeps ISO strings.
const toMs = (iso: string) => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new StorageError('WRITE_FAILED', 'Invalid timestamp');
  }
  return ms;
};
const toIso = (ms: unknown) => new Date(Number(ms)).toISOString();

// Money is stored in minor units (cents) to avoid floating-point drift.
const toMinor = (amount: number | null) =>
  amount == null ? null : Math.round(amount * 100);
const fromMinor = (minor: unknown) =>
  minor == null ? null : Number(minor) / 100;

const str = (v: unknown) => String(v ?? '');
const bool = (v: unknown) => Number(v) === 1;

function base(row: SqlRow) {
  return {
    id: str(row.id),
    title: str(row.title),
    pinned: bool(row.pinned),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ITEM_COLUMNS = 'i.id, i.title, i.pinned, i.created_at, i.updated_at';

export class SqliteItemRepository implements ItemRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listAll(): Promise<Item[]> {
    const [notes, reminders, cards, documents] = await Promise.all([
      this.db.execute(
        `SELECT ${ITEM_COLUMNS}, d.body
         FROM items i JOIN notes d ON d.item_id = i.id`,
      ),
      this.db.execute(
        `SELECT ${ITEM_COLUMNS}, d.due_at, d.local_start, d.repeat,
                d.interval_minutes, d.notes, d.completed
         FROM items i JOIN reminders d ON d.item_id = i.id`,
      ),
      this.db.execute(
        `SELECT ${ITEM_COLUMNS}, d.card_number, d.code_format, d.holder_name, d.notes
         FROM items i JOIN cards d ON d.item_id = i.id`,
      ),
      this.db.execute(
        `SELECT ${ITEM_COLUMNS}, d.kind, d.merchant, d.date, d.expires_on,
                d.amount_minor, d.currency, d.notes
         FROM items i JOIN documents d ON d.item_id = i.id`,
      ),
    ]);

    const items: Item[] = [
      ...notes.map(
        (r): Note => ({ ...base(r), type: 'note', body: str(r.body) }),
      ),
      ...reminders.map(
        (r): Reminder => ({
          ...base(r),
          type: 'reminder',
          dueAt: toIso(r.due_at),
          localStart: str(r.local_start),
          repeat: str(r.repeat) as ReminderRepeat,
          intervalMinutes:
            r.interval_minutes == null ? null : Number(r.interval_minutes),
          notes: str(r.notes),
          completed: bool(r.completed),
        }),
      ),
      ...cards.map(
        (r): LoyaltyCard => ({
          ...base(r),
          type: 'card',
          cardNumber: str(r.card_number),
          codeFormat: str(r.code_format) as CardCodeFormat,
          holderName: str(r.holder_name),
          notes: str(r.notes),
        }),
      ),
      ...documents.map(
        (r): DocumentItem => ({
          ...base(r),
          type: 'document',
          kind: str(r.kind) as DocumentKind,
          merchant: str(r.merchant),
          date: r.date == null ? null : str(r.date),
          expiresOn: r.expires_on == null ? null : str(r.expires_on),
          amount: fromMinor(r.amount_minor),
          currency: str(r.currency),
          notes: str(r.notes),
          // Attachments are not stored yet (later phase).
          attachment: null,
        }),
      ),
    ];
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Reads every item from the encrypted database, then matches in JS.
   * SQLite's LIKE and lower() only fold ASCII case, so "Š" would not match
   * "š"; matching in JS keeps search Unicode-aware. Fine at personal-organizer
   * scale; revisit (e.g. a normalized search column) if data grows large.
   */
  async search(term: string): Promise<Item[]> {
    return filterBySearch(await this.listAll(), term);
  }

  async save(item: Item): Promise<void> {
    try {
      await this.db.transaction(async tx => {
        await tx.execute(
          `INSERT INTO items (id, type, title, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             title = excluded.title,
             pinned = excluded.pinned,
             updated_at = excluded.updated_at`,
          [
            item.id,
            item.type,
            item.title,
            item.pinned ? 1 : 0,
            toMs(item.createdAt),
            toMs(item.updatedAt),
          ],
        );
        const stored = await tx.execute('SELECT type FROM items WHERE id = ?', [
          item.id,
        ]);
        if (stored[0]?.type !== item.type) {
          throw new Error(`Item ${item.id} cannot change type`);
        }
        await saveDetail(tx, item);
      });
    } catch (e) {
      throw new StorageError('WRITE_FAILED', (e as Error).message);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // Detail rows go with it (ON DELETE CASCADE).
      await this.db.execute('DELETE FROM items WHERE id = ?', [id]);
    } catch (e) {
      throw new StorageError('WRITE_FAILED', (e as Error).message);
    }
  }
}

function saveDetail(tx: SqlExecutor, item: Item) {
  switch (item.type) {
    case 'note':
      return tx.execute(
        `INSERT INTO notes (item_id, body) VALUES (?, ?)
         ON CONFLICT (item_id) DO UPDATE SET body = excluded.body`,
        [item.id, item.body],
      );
    case 'reminder':
      return tx.execute(
        `INSERT INTO reminders
           (item_id, due_at, local_start, repeat, interval_minutes, notes, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET
           due_at = excluded.due_at, local_start = excluded.local_start,
           repeat = excluded.repeat, interval_minutes = excluded.interval_minutes,
           notes = excluded.notes, completed = excluded.completed`,
        [
          item.id,
          toMs(item.dueAt),
          item.localStart,
          item.repeat,
          item.repeat === 'interval' ? item.intervalMinutes : null,
          item.notes,
          item.completed ? 1 : 0,
        ],
      );
    case 'card':
      return tx.execute(
        `INSERT INTO cards (item_id, card_number, code_format, holder_name, notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET
           card_number = excluded.card_number, code_format = excluded.code_format,
           holder_name = excluded.holder_name, notes = excluded.notes`,
        [
          item.id,
          item.cardNumber,
          item.codeFormat,
          item.holderName,
          item.notes,
        ],
      );
    case 'document':
      return tx.execute(
        `INSERT INTO documents
           (item_id, kind, merchant, date, expires_on, amount_minor, currency, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET
           kind = excluded.kind, merchant = excluded.merchant, date = excluded.date,
           expires_on = excluded.expires_on, amount_minor = excluded.amount_minor,
           currency = excluded.currency, notes = excluded.notes`,
        [
          item.id,
          item.kind,
          item.merchant,
          item.date,
          item.expiresOn,
          toMinor(item.amount),
          item.currency,
          item.notes,
        ],
      );
  }
}
