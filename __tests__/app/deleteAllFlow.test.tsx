import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import NativeTrezorAppLock from '../../src/native/NativeTrezorAppLock';
import { runMigrations } from '../../src/storage/migrations';
import type { SqlDatabase } from '../../src/storage/sql';
import {
  hasText,
  pressLabel,
  pressText,
  settle,
  texts,
} from '../../test-utils/appHarness';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// Settings → Delete all data (Phase 7). The operation itself is faked here;
// deleteAll.test.ts covers what it does.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

let mockDb: SqlDatabase;
jest.mock('../../src/storage/openStorage', () => ({
  openStorage: async () => {
    const { serializeDatabase } = require('../../src/storage/serialDatabase');
    const database = serializeDatabase(mockDb);
    const items =
      new (require('../../src/storage/SqliteItemRepository').SqliteItemRepository)(
        database,
      );
    const settings =
      new (require('../../src/storage/SettingsRepository').SqliteSettingsRepository)(
        database,
      );
    return {
      items,
      settings,
      database,
      initialItems: [],
      initialTheme: 'system',
    };
  },
}));

const mockDeleteAll = jest.fn();
jest.mock('../../src/storage/deleteAll', () => {
  const actual = jest.requireActual('../../src/storage/deleteAll');
  return { ...actual, deleteAllData: (o: unknown) => mockDeleteAll(o) };
});

const { DeleteAllError } = jest.requireActual('../../src/storage/deleteAll');
const appLock = NativeTrezorAppLock as jest.Mocked<typeof NativeTrezorAppLock>;
const TITLE = 'Delete all data?';
let app: ReactTestRenderer.ReactTestRenderer;

beforeEach(async () => {
  jest.clearAllMocks();
  appLock.getState.mockReturnValue(
    '{"enabled":false,"locked":false,"availability":"available"}',
  );
  mockDeleteAll.mockReturnValue(new Promise(() => undefined));
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await pressLabel(app, 'Settings');
});

afterEach(() => {
  ReactTestRenderer.act(() => app.unmount());
});

const dialog = () =>
  app.root.find(n => n.props.title === TITLE && 'onConfirm' in n.props);

test('the dialog explains what goes and what stays; Cancel deletes nothing', async () => {
  await pressText(app, 'Delete all data');
  expect(dialog().props.visible).toBe(true);
  expect(dialog().props.message).toBe(
    'All notes, reminders, cards, documents and attached files on this device are permanently deleted, and Trezor starts empty. Backup files you saved outside Trezor are not affected. This can’t be undone.',
  );
  await pressText(app, 'Cancel');
  expect(dialog().props.visible).toBe(false);
  expect(mockDeleteAll).not.toHaveBeenCalled();
});

test('Back up first opens the backup screen and deletes nothing', async () => {
  await pressText(app, 'Delete all data');
  await pressText(app, 'Back up first');
  expect(hasText(app, 'Choose where to save')).toBe(true);
  expect(mockDeleteAll).not.toHaveBeenCalled();
});

test('Delete everything shows the blocking state and starts exactly once', async () => {
  await pressText(app, 'Delete all data');
  await ReactTestRenderer.act(async () => {
    dialog().props.onConfirm();
    dialog().props.onConfirm();
  });
  await settle();
  expect(mockDeleteAll).toHaveBeenCalledTimes(1);
  const options = mockDeleteAll.mock.calls[0][0];
  expect(typeof options.database.exclusive).toBe('function');
  // App Lock off: no extra prompt.
  expect(options.confirmIdentity).toBeUndefined();
  expect(texts(app).join(' ')).toContain('Deleting…');
});

test('with App Lock on, the system prompt comes right before deleting', async () => {
  ReactTestRenderer.act(() => app.unmount());
  appLock.getState.mockReturnValue(
    '{"enabled":true,"locked":false,"availability":"available"}',
  );
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await pressLabel(app, 'Settings');
  await pressText(app, 'Delete all data');
  await pressText(app, 'Delete everything');
  const options = mockDeleteAll.mock.calls[0][0];
  await options.confirmIdentity();
  expect(appLock.confirm).toHaveBeenCalledWith('Delete all data');
});

test('a cancel says nothing; a refusal or failure says nothing was deleted, and it can be tried again', async () => {
  const cases: [string, string | null][] = [
    ['CANCELLED', null],
    ['RESTORE_IN_PROGRESS', 'A restore is in progress. Nothing was deleted.'],
    ['FAILED', 'Nothing was deleted. Try again.'],
  ];
  for (const [code, message] of cases) {
    mockDeleteAll.mockRejectedValueOnce(new DeleteAllError(code));
    await pressText(app, 'Delete all data');
    await pressText(app, 'Delete everything');
    expect(texts(app).join(' ')).not.toContain('Deleting…');
    if (message) {
      expect(hasText(app, message)).toBe(true);
    } else {
      expect(texts(app).join(' ')).not.toContain('Nothing was deleted');
    }
  }
  expect(mockDeleteAll).toHaveBeenCalledTimes(3);
});
