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

type InitialData = Omit<OpenedStorage, 'items' | 'settings'>;

interface Initialized {
  items: ItemRepository;
  settings: SettingsRepository;
  /** Loaded during initialization, for the caller that started it. */
  first: InitialData;
}

/**
 * The process's storage, once initialization has started. Every React root
 * (a recreated Activity mounts another while the JS runtime lives on) shares
 * this one connection, its operation queue and its repositories, so a second
 * root never opens, migrates or cleans up on its own.
 */
let shared: Promise<Initialized> | null = null;

/**
 * Opens the encrypted database once per process and loads what the first
 * screen needs. Initialization also removes attachment files no row refers
 * to (left by a crash between writing a file and saving its item, or after
 * deleting an item); this runs before the UI can pick new files, and never
 * touches a file the database knows.
 *
 * If the database has to be created while attachment files exist (its file
 * is missing, but the key is not), those files may be all that is left of the
 * original, so they are recorded as kept before the new database exists and
 * are never collected. Native code also runs the cleanup at most once per
 * process.
 *
 * A caller that arrives while initialization runs waits for it; one that
 * arrives later loads its own initial data from the shared connection. If
 * initialization fails, its connection is closed and the next call (Retry)
 * starts afresh.
 */
export async function openStorage(
  attachments: AttachmentPlatform = nativeAttachmentPlatform,
): Promise<OpenedStorage> {
  let attempt = shared;
  const started = attempt === null;
  if (attempt === null) {
    const mine = initialize(attachments);
    shared = attempt = mine;
    // Frees the slot for a Retry; a newer attempt is never cleared.
    mine.catch(() => {
      if (shared === mine) {
        shared = null;
      }
    });
  }
  const { items, settings, first } = await attempt;
  // A later root must not start from data the first one has changed since.
  const initial = started ? first : await loadInitial(items, settings);
  return { items, settings, ...initial };
}

async function initialize(
  attachments: AttachmentPlatform,
): Promise<Initialized> {
  const opened = await openTrezorDatabase({
    beforeCreate: async () => {
      await attachments.keepUnreferenced();
    },
  });
  // Every read and write on the shared connection goes through one queue.
  const db = serializeDatabase(opened.db);
  try {
    const items = new SqliteItemRepository(db);
    const settings = new SqliteSettingsRepository(db);
    const first = await loadInitial(items, settings);
    try {
      await attachments.collectGarbage(await items.listAttachmentIds());
    } catch (e) {
      // Orphans only cost space; try again next launch. Code only, never names.
      const code = (e as { code?: unknown } | null)?.code;
      console.warn(
        `[attachments] cleanup failed: ${String(code ?? 'UNKNOWN')}`,
      );
    }
    return { items, settings, first };
  } catch (e) {
    // No connection is left without an owner: statements already queued
    // settle first, then it closes. The original error is reported.
    await db.closeWhenIdle().catch(() => undefined);
    throw e;
  }
}

async function loadInitial(
  items: ItemRepository,
  settings: SettingsRepository,
): Promise<InitialData> {
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
  return {
    initialItems,
    initialTheme: theme ?? 'system',
    initialShowReminderDetails: showDetails === true,
    initialPermissionRequested: permissionRequested === true,
    initialExactAlarmRequested: exactRequested === true,
  };
}
