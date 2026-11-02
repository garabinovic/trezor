import React from 'react';
import { DeviceEventEmitter } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type { Item, Reminder } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { serializeDatabase } from '../../src/storage/serialDatabase';
import { SqliteSettingsRepository } from '../../src/storage/SettingsRepository';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
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
const scheduled = () => fakeReminders.entries.map(e => e.id).sort();

let app: ReactTestRenderer.ReactTestRenderer;

async function launch() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  await settle(400); // initial reconciliation (debounced)
}

async function restart() {
  await ReactTestRenderer.act(async () => app.unmount());
  await launch();
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

describe('creating reminders of each recurrence type', () => {
  test.each([
    ['Once', 'once', null],
    ['Daily', 'daily', null],
    ['Weekly', 'weekly', null],
    ['Monthly', 'monthly', null],
    ['Yearly', 'yearly', null],
    ['Interval', 'interval', 120],
  ] as const)('%s', async (chip, mode, interval) => {
    await launch();
    await openTab(app, 'Reminders');
    await pressLabel(app, 'New reminder');
    await typeInto(app, 'Title', `My ${mode}`);
    await pressText(app, chip);
    if (mode === 'interval') {
      await pressText(app, '2 hours');
    }
    await pressText(app, 'Save');
    await reconciled();

    const saved = (await stored().listAll()).find(
      i => i.title === `My ${mode}`,
    ) as Reminder;
    expect(saved).toMatchObject({ repeat: mode, intervalMinutes: interval });
    expect(saved.localStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const entry = fakeReminders.entries.find(e => e.id === saved.id);
    expect(entry).toMatchObject({ mode, intervalMinutes: interval });
    // Details are hidden by default.
    expect(entry?.title).toBeNull();
  });
});

describe('changing, completing, deleting', () => {
  test('changing recurrence replaces the schedule without duplicates', async () => {
    await seed([seedReminder({ id: 'a' })]);
    await launch();
    expect(scheduled()).toEqual(['a']);
    await openTab(app, 'Reminders');
    await pressText(app, 'Reminder a');
    await pressLabel(app, 'Edit');
    await pressText(app, 'Weekly');
    await pressText(app, 'Save');
    await reconciled();
    expect(fakeReminders.entries).toHaveLength(1);
    expect(fakeReminders.entries[0]).toMatchObject({ id: 'a', mode: 'weekly' });
    expect((await storedReminder('a'))?.repeat).toBe('weekly');
  });

  test('completing cancels; reactivating a repeating reminder schedules it again', async () => {
    await seed([seedReminder({ id: 'r', repeat: 'daily' })]);
    await launch();
    await openTab(app, 'Reminders');
    await pressText(app, 'Reminder r');
    await pressText(app, 'Mark as done');
    await reconciled();
    expect(scheduled()).toEqual([]);
    expect((await storedReminder('r'))?.completed).toBe(true);

    await pressText(app, 'Mark as not done');
    await reconciled();
    expect(scheduled()).toEqual(['r']);
  });

  test('a reactivated one-time reminder in the past is not scheduled', async () => {
    await seed([
      seedReminder({ id: 'p', dueAt: inHours(-2), completed: true }),
    ]);
    await launch();
    await openTab(app, 'Reminders');
    await pressText(app, 'Done');
    await pressText(app, 'Reminder p');
    await pressText(app, 'Mark as not done');
    await reconciled();
    expect((await storedReminder('p'))?.completed).toBe(false);
    expect(scheduled()).toEqual([]);
  });

  test('deleting removes the reminder and its schedule', async () => {
    await seed([seedReminder({ id: 'd' }), seedReminder({ id: 'k' })]);
    await launch();
    expect(scheduled()).toEqual(['d', 'k']);
    await openTab(app, 'Reminders');
    await pressText(app, 'Reminder d');
    await pressLabel(app, 'Delete');
    await pressText(app, 'Delete');
    await reconciled();
    expect(await storedReminder('d')).toBeUndefined();
    expect(scheduled()).toEqual(['k']);
  });

  test('a ONCE reminder that fired is marked completed on launch', async () => {
    await seed([seedReminder({ id: 'f', dueAt: inHours(1) })]);
    fakeReminders.fired = ['f'];
    await launch();
    await settle(300);
    expect((await storedReminder('f'))?.completed).toBe(true);
    expect(scheduled()).toEqual([]);
  });
});

describe('notification taps', () => {
  test('a tap while the app is running opens the reminder', async () => {
    await seed([seedReminder({ id: 't' })]);
    await launch();
    fakeReminders.pendingTap = 't';
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('trezorReminderTap');
    });
    await settle();
    expect(hasText(app, 'Reminder t')).toBe(true);
    expect(hasText(app, 'Due')).toBe(true);
    expect(fakeReminders.pendingTap).toBeNull();
  });

  test('a tap that launched the app opens the reminder', async () => {
    await seed([seedReminder({ id: 'cold', repeat: 'daily' })]);
    fakeReminders.pendingTap = 'cold';
    await launch();
    expect(hasText(app, 'Reminder cold')).toBe(true);
    expect(hasText(app, 'Next')).toBe(true);
  });

  test('a tap for a deleted reminder shows "Item not found" and recreates nothing', async () => {
    fakeReminders.pendingTap = 'gone';
    await launch();
    expect(hasText(app, 'Item not found')).toBe(true);
    expect(await stored().listAll()).toEqual([]);
    expect(scheduled()).toEqual([]);
  });
});

describe('notification privacy and permission', () => {
  test('showing details adds text to the schedule and persists across restarts', async () => {
    await seed([seedReminder({ id: 'p', repeat: 'monthly' })]);
    await launch();
    expect(fakeReminders.entries[0].title).toBeNull();
    const before = { ...fakeReminders.entries[0], title: null, body: null };

    await pressLabel(app, 'Settings');
    expect(hasText(app, 'Notification privacy')).toBe(true);
    expect(
      hasText(
        app,
        'Allow reminder titles and descriptions to appear in notifications.',
      ),
    ).toBe(true);
    const toggle = app.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Show reminder details' &&
        typeof n.props.onValueChange === 'function',
    )[0];
    await ReactTestRenderer.act(async () => toggle.props.onValueChange(true));
    await reconciled();
    expect(fakeReminders.showDetails).toBe(true);
    expect(fakeReminders.entries[0]).toMatchObject({
      title: 'Reminder p',
      body: 'Details p',
    });
    // Same times and recurrence; only the content changed.
    expect({ ...fakeReminders.entries[0], title: null, body: null }).toEqual(
      before,
    );
    expect(
      await new SqliteSettingsRepository(serializeDatabase(mockDb)).get(
        'notifications.showDetails',
      ),
    ).toBe(true);

    await restart();
    expect(fakeReminders.showDetails).toBe(true);
    expect(fakeReminders.entries[0].title).toBe('Reminder p');
  });

  test('when notifications are off, Settings offers the Android settings path', async () => {
    fakeReminders.enabled = false;
    await launch();
    await pressLabel(app, 'Settings');
    expect(hasText(app, 'Notifications are off')).toBe(true);
  });

  test('a scheduling failure is reported in Settings, and data is kept', async () => {
    await seed([seedReminder({ id: 'x' })]);
    fakeReminders.failNextSync = true;
    await launch();
    await pressLabel(app, 'Settings');
    expect(
      hasText(
        app,
        'Reminders couldn’t be scheduled just now. Trezor will try again automatically.',
      ),
    ).toBe(true);
    expect(await storedReminder('x')).toBeDefined();
  });
});
