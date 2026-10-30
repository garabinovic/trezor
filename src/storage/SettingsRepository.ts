import { StorageError } from './errors';
import { SqlDatabase } from './sql';

/** Persistent settings and their value types. Add keys here as settings grow. */
export interface SettingValues {
  'theme.preference': 'system' | 'light' | 'dark';
}

export type SettingKey = keyof SettingValues;

export interface SettingsRepository {
  get<K extends SettingKey>(key: K): Promise<SettingValues[K] | null>;
  set<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void>;
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K] | null> {
    const rows = await this.db.execute(
      'SELECT value FROM settings WHERE key = ?',
      [key],
    );
    if (rows.length === 0) {
      return null;
    }
    try {
      return JSON.parse(String(rows[0].value)) as SettingValues[K];
    } catch {
      return null;
    }
  }

  async set<K extends SettingKey>(key: K, value: SettingValues[K]) {
    try {
      await this.db.execute(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    } catch (e) {
      throw new StorageError('WRITE_FAILED', (e as Error).message);
    }
  }
}

export class InMemorySettingsRepository implements SettingsRepository {
  private values = new Map<SettingKey, unknown>();

  async get<K extends SettingKey>(key: K) {
    return (this.values.get(key) as SettingValues[K] | undefined) ?? null;
  }

  async set<K extends SettingKey>(key: K, value: SettingValues[K]) {
    this.values.set(key, value);
  }
}
