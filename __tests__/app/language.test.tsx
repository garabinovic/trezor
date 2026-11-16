import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type { DocumentItem, Note } from '../../src/data/types';
import {
  LANGUAGES,
  languageNames,
  nativeTexts,
  stringsFor,
} from '../../src/i18n';
import NativeTrezorLocale from '../../src/native/NativeTrezorLocale';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import {
  hasText,
  pressLabel,
  pressText,
  settle,
} from '../../test-utils/appHarness';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// Settings → Language on the real app: English by default, applied at once,
// stored natively (outside the database and backups), restored on restart.
// User content and stored values are never translated.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

let mockDb: SqlDatabase;
jest.mock('../../src/storage/openStorage', () => ({
  openStorage: async () => {
    const {
      serializeDatabase: serialize,
    } = require('../../src/storage/serialDatabase');
    const db = serialize(mockDb);
    const items =
      new (require('../../src/storage/SqliteItemRepository').SqliteItemRepository)(
        db,
      );
    const settings =
      new (require('../../src/storage/SettingsRepository').SqliteSettingsRepository)(
        db,
      );
    return {
      items,
      settings,
      initialItems: await items.listAll(),
      initialTheme: 'system',
    };
  },
}));

const locale = NativeTrezorLocale as unknown as {
  store: { language: string; texts: Record<string, string> };
  getLanguage: jest.Mock;
  setLanguage: jest.Mock;
  __reset: () => void;
};

const note: Note = {
  id: 'n1',
  type: 'note',
  title: 'Ljubav i njiva',
  body: 'Kupiti mleko',
  pinned: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const doc: DocumentItem = {
  id: 'd1',
  type: 'document',
  title: 'Passport',
  kind: 'document',
  merchant: '',
  date: null,
  expiresOn: null,
  amount: null,
  currency: 'EUR',
  notes: '',
  attachments: [],
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

let app: ReactTestRenderer.ReactTestRenderer;

async function launch() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await settle();
}

async function restart() {
  await ReactTestRenderer.act(async () => app.unmount());
  await launch();
}

/** The Settings screen title, in whichever language is in use. */
const SETTINGS_TITLE = {
  en: 'Settings',
  'sr-Latn': 'Podešavanja',
  'sr-Cyrl': 'Подешавања',
  ru: 'Настройки',
  es: 'Ajustes',
} as const;

beforeEach(async () => {
  locale.__reset();
  jest.clearAllMocks();
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  const repo = new SqliteItemRepository(mockDb);
  await repo.save(note);
  await repo.save(doc);
});

afterEach(() => {
  ReactTestRenderer.act(() => app.unmount());
});

test('a new installation starts in English and lists the five languages by their own names', async () => {
  await launch();
  expect(hasText(app, 'Coming up') || hasText(app, 'Pinned')).toBe(true);
  // The native strings are handed over in English at start.
  expect(locale.setLanguage).toHaveBeenCalledWith(
    'en',
    JSON.stringify(nativeTexts('en')),
  );
  await pressLabel(app, 'Settings');
  expect(hasText(app, 'Language')).toBe(true);
  for (const language of LANGUAGES) {
    expect(hasText(app, languageNames[language])).toBe(true);
  }
  // Of the language rows, only English is selected.
  const names = new Set<string>(Object.values(languageNames));
  const selected = app.root
    .findAll(
      n =>
        n.props.accessibilityState?.selected === true &&
        typeof n.props.onPress === 'function',
    )
    .flatMap(row =>
      row
        .findAll(n => n.type === ('Text' as never))
        .map(n => ([] as unknown[]).concat(n.props.children).join('')),
    )
    .filter(label => names.has(label));
  expect(new Set(selected)).toEqual(new Set(['English']));
});

test('switching applies at once, in all five languages, and stores the choice with its native strings', async () => {
  await launch();
  await pressLabel(app, 'Settings');
  for (const language of [...LANGUAGES.slice(1), 'en' as const]) {
    await pressText(app, languageNames[language]);
    expect([language, hasText(app, SETTINGS_TITLE[language])]).toEqual([
      language,
      true,
    ]);
    expect(locale.store.language).toBe(language);
    expect(locale.store.texts).toEqual(nativeTexts(language));
  }
  expect(locale.store.texts.reminderBody).toBe('You have a reminder.');
});

test('the choice survives a restart', async () => {
  await launch();
  await pressLabel(app, 'Settings');
  await pressText(app, 'Русский');
  expect(hasText(app, 'Настройки')).toBe(true);

  await restart();
  // Home in Russian straight away; the stored choice was read at start.
  expect(hasText(app, 'Закреплённые')).toBe(true);
  expect(hasText(app, 'Pinned')).toBe(false);
});

test('Serbian Latin and Cyrillic are different; user content stays exactly as written', async () => {
  await launch();
  await pressLabel(app, 'Settings');
  await pressText(app, 'Srpski (latinica)');
  expect(hasText(app, 'Podešavanja')).toBe(true);
  await pressText(app, 'Српски (ћирилица)');
  expect(hasText(app, 'Подешавања')).toBe(true);
  expect(hasText(app, 'Podešavanja')).toBe(false);

  await pressLabel(app, 'Назад');
  // The note's title isn't transliterated, though the UI around it is.
  expect(hasText(app, 'Закачено')).toBe(true);
  expect(hasText(app, 'Ljubav i njiva')).toBe(true);
  await pressLabel(app, 'Документи, картица');
  expect(hasText(app, 'Passport')).toBe(true);
  expect(hasText(app, 'Датотеке')).toBe(true);

  // Nothing stored changed: the same records and kind values as before.
  const items = await new SqliteItemRepository(
    serializeDatabase(mockDb),
  ).listAll();
  expect(items.find(i => i.id === 'n1')).toMatchObject({
    title: 'Ljubav i njiva',
    body: 'Kupiti mleko',
  });
  expect(items.find(i => i.id === 'd1')).toMatchObject({
    title: 'Passport',
    kind: 'document',
  });
  // The language isn't a database setting, so it isn't in backups.
  const settings = await mockDb.execute('SELECT key FROM settings');
  expect(JSON.stringify(settings)).not.toMatch(/lang|locale/i);
});

test.each([
  ['en', 'Stash', 'About Stash'],
  ['sr-Latn', 'Štek', 'O Šteku'],
  ['sr-Cyrl', 'Штек', 'О Штеку'],
  ['ru', 'Тайник', 'О Тайнике'],
  ['es', 'Stash', 'Acerca de Stash'],
] as const)(
  'the app name follows the language chosen in the app (%s): About and Home',
  async (language, name, about) => {
    await launch();
    await pressLabel(app, 'Settings');
    await pressText(app, languageNames[language]);
    expect(hasText(app, about)).toBe(true);
    await pressLabel(app, stringsFor(language).common.back);
    expect(hasText(app, name)).toBe(true);
    expect(hasText(app, 'Trezor')).toBe(false);
  },
);
