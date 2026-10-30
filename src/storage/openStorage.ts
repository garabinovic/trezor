import type { Item } from '../data/types';
import { openTrezorDatabase } from './database';
import { ItemRepository } from './ItemRepository';
import { serializeDatabase } from './serialDatabase';
import {
  SettingsRepository,
  SettingValues,
  SqliteSettingsRepository,
} from './SettingsRepository';
import { SqliteItemRepository } from './SqliteItemRepository';

export interface OpenedStorage {
  items: ItemRepository;
  settings: SettingsRepository;
  /** Loaded up front so the first screen renders complete, without a flash. */
  initialItems: Item[];
  initialTheme: SettingValues['theme.preference'];
}

/** Opens the encrypted database and loads what the first screen needs. */
export async function openStorage(): Promise<OpenedStorage> {
  const opened = await openTrezorDatabase();
  // Every read and write on the shared connection goes through one queue.
  const db = serializeDatabase(opened.db);
  const items = new SqliteItemRepository(db);
  const settings = new SqliteSettingsRepository(db);
  const [initialItems, theme] = await Promise.all([
    items.listAll(),
    settings.get('theme.preference'),
  ]);
  return { items, settings, initialItems, initialTheme: theme ?? 'system' };
}
