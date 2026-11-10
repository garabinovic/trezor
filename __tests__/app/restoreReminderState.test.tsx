import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type { Item, Reminder } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import {
  announceCompleted,
  holdReconcile,
  resetReconcileGateForTests,
  runReconcile,
} from '../../src/reminders/reconcileGate';
import {
  hasText,
  openTab,
  pressLabel,
  pressText,
  settle,
  typeInto,
} from '../../test-utils/appHarness';
import { fakeReminders } from '../../test-utils/fakeReminders';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

let mockDb: SqlDatabase;
jest.mock('../../src/storage/openStorage', () => ({
  openStorage: async () => {
    const db = require('../../src/storage/serialDatabase').serializeDatabase(
      mockDb,
    );
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
      initialShowReminderDetails:
        (await settings.get('notifications.showDetails')) === true,
      initialPermissionRequested:
        (await settings.get('notifications.permissionRequested')) === true,
      initialExactAlarmRequested:
        (await settings.get('notifications.exactAlarmRequested')) === true,
    };
  },
}));

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

function seedReminder(patch: Partial<Reminder> & { id: string }): Reminder {
  return {
    type: 'reminder',
    title: `Reminder ${patch.id}`,
    dueAt: inHours(5),
    localStart: '2026-11-02T10:00',
    repeat: 'once',
    intervalMinutes: null,
    notes: `Details ${patch.id}`,
    completed: false,
    pinned: false,
    createdAt: inHours(-48),
    updatedAt: inHours(-48),
    ...patch,
  };
}

const stored = () => new SqliteItemRepository(serializeDatabase(mockDb));
const storedReminder = async (id: string) =>
  (await stored().listAll()).find(i => i.id === id) as Reminder | undefined;

let app: ReactTestRenderer.ReactTestRenderer;

async function launch() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await settle(400); // initial reconciliation (debounced)
}

/** Waits for the debounced reconciliation after a change. */
const reconciled = () => settle(450);

async function seed(items: Item[]) {
  const repo = stored();
  for (const item of items) {
    await repo.save(item);
  }
}

beforeEach(async () => {
  fakeReminders.reset();
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => app?.unmount());
});

// Phase 6 Step 3 review L3: a restore preparation completes fired ONCE
// reminders directly in the live database (§8.2 step 9). When it ends before
// the swap, the item state must pick that up, or a later edit would write
// "not completed" back.
describe('after a restore preparation that completed reminders', () => {
  afterEach(() => resetReconcileGateForTests());

  test('the item state reloads them, so editing keeps them completed', async () => {
    await seed([seedReminder({ id: 'a' })]);
    await launch();
    // As step 9 does, behind the UI, while the restore holds the reconcile gate.
    const release = await holdReconcile();
    await mockDb.execute(
      "UPDATE reminders SET completed = 1 WHERE item_id = 'a'",
    );
    await ReactTestRenderer.act(async () => {
      release({ completed: ['a'] });
    });
    await reconciled();

    await openTab(app, 'Reminders');
    await pressText(app, 'Done');
    expect(hasText(app, 'Reminder a')).toBe(true);
    await pressText(app, 'Reminder a');
    await pressLabel(app, 'Edit');
    await typeInto(app, 'Title', 'Renamed after restore');
    await pressText(app, 'Save');
    await reconciled();

    const after = await storedReminder('a');
    expect(after?.title).toBe('Renamed after restore');
    expect(after?.completed).toBe(true);
  });

  test('while a failed cleanup keeps the gate held, the item state reloads them too (review L-C)', async () => {
    await seed([seedReminder({ id: 'b' })]);
    await launch();
    const release = await holdReconcile();
    await mockDb.execute(
      "UPDATE reminders SET completed = 1 WHERE item_id = 'b'",
    );
    // What prepareRestore does when its cleanup fails: announce, don't release.
    await ReactTestRenderer.act(async () => {
      announceCompleted(['b']);
    });
    await settle(100);
    let reconciledMeanwhile = false;
    const waiting = runReconcile(async () => {
      reconciledMeanwhile = true;
    });

    await openTab(app, 'Reminders');
    await pressText(app, 'Done');
    await pressText(app, 'Reminder b');
    await pressLabel(app, 'Edit');
    await typeInto(app, 'Title', 'Edited while pending');
    await pressText(app, 'Save');
    await settle(100);

    const after = await storedReminder('b');
    expect(after?.title).toBe('Edited while pending');
    expect(after?.completed).toBe(true);
    // Still no reconcile: the gate wasn't released.
    expect(reconciledMeanwhile).toBe(false);
    await ReactTestRenderer.act(async () => release());
    await waiting;
  });
});
