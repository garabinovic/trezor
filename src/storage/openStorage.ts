import {
  AttachmentPlatform,
  nativeAttachmentPlatform,
} from '../attachments/platform';
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
  initialShowReminderDetails: boolean;
  initialPermissionRequested: boolean;
  initialExactAlarmRequested: boolean;
}

/**
 * Opens the encrypted database and loads what the first screen needs. Then
 * removes attachment files no row refers to (left by a crash between writing
 * a file and saving its item, or after deleting an item); this runs before
 * the UI can pick new files, and never touches a file the database knows.
 *
 * If the database has to be created while attachment files exist (its file
 * is missing, but the key is not), those files may be all that is left of the
 * original, so they are recorded as kept before the new database exists and
 * are never collected. Native code also runs the cleanup at most once per
 * process, so a second React root (the Activity recreated) can't remove a file
 * the first one is still saving.
 */
export async function openStorage(
  attachments: AttachmentPlatform = nativeAttachmentPlatform,
): Promise<OpenedStorage> {
  const opened = await openTrezorDatabase({
    beforeCreate: async () => {
      await attachments.keepUnreferenced();
    },
  });
  // Every read and write on the shared connection goes through one queue.
  const db = serializeDatabase(opened.db);
  const items = new SqliteItemRepository(db);
  const settings = new SqliteSettingsRepository(db);
  const [
    initialItems,
    theme,
    showDetails,
    permissionRequested,
    exactRequested,
  ] = await Promise.all([
    items.listAll(),
    settings.get('theme.preference'),
    settings.get('notifications.showDetails'),
    settings.get('notifications.permissionRequested'),
    settings.get('notifications.exactAlarmRequested'),
  ]);
  try {
    await attachments.collectGarbage(await items.listAttachmentIds());
  } catch (e) {
    // Orphans only cost space; try again next launch. Code only, never names.
    const code = (e as { code?: unknown } | null)?.code;
    console.warn(`[attachments] cleanup failed: ${String(code ?? 'UNKNOWN')}`);
  }
  return {
    items,
    settings,
    initialItems,
    initialTheme: theme ?? 'system',
    initialShowReminderDetails: showDetails === true,
    initialPermissionRequested: permissionRequested === true,
    initialExactAlarmRequested: exactRequested === true,
  };
}
