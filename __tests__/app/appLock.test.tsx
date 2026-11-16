import React from 'react';
import { AppState, DeviceEventEmitter, StyleSheet } from 'react-native';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import App from '../../App';
import { runMigrations } from '../../src/storage/migrations';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import { spacing } from '../../src/theme';
import {
  hasText,
  pressLabel,
  pressText,
  settle,
  texts,
} from '../../test-utils/appHarness';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// App Lock (Phase 5) on the real app. The native module is a fake whose state
// stands for what Android decided: the UI must follow it and can't unlock by
// itself.
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
      initialItems: await items.listAll(),
      initialTheme: 'system',
    };
  },
}));

const mockNative = {
  state: { enabled: true, locked: true, availability: 'available' },
  authenticate: jest.fn(),
  setEnabled: jest.fn(),
};
jest.mock('../../src/native/NativeTrezorAppLock', () => ({
  __esModule: true,
  default: {
    getState: () => JSON.stringify(mockNative.state),
    authenticate: () => mockNative.authenticate(),
    setEnabled: (enabled: boolean) => mockNative.setEnabled(enabled),
    confirm: async () => undefined,
  },
}));

/** What native does after the system prompt succeeded. */
const nativeUnlocks = () => {
  mockNative.state = { ...mockNative.state, locked: false };
};
const coded = (code: string) => Object.assign(new Error(code), { code });

const LOCKED = 'Stash is locked';
let app: ReactTestRenderer.ReactTestRenderer;

async function render() {
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
}

/** Native locked the app (it left the foreground) and announced it. */
async function nativeLocks() {
  mockNative.state = { ...mockNative.state, locked: true };
  await ReactTestRenderer.act(async () => {
    DeviceEventEmitter.emit('trezorAppLockChanged');
  });
  await settle();
}

beforeEach(async () => {
  jest.clearAllMocks();
  // In the foreground, as on a device when the app opens.
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
  mockNative.state = { enabled: true, locked: true, availability: 'available' };
  mockNative.authenticate.mockImplementation(async () => nativeUnlocks());
  mockNative.setEnabled.mockResolvedValue(undefined);
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await new SqliteItemRepository(mockDb).save({
    id: 'n1',
    type: 'note',
    title: 'Safe combination',
    body: '12-34-56',
    pinned: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  });
});

afterEach(() => {
  ReactTestRenderer.act(() => app.unmount());
});

test('locked at start: only the lock screen, the system prompt opens once, then the app', async () => {
  let finish!: () => void;
  mockNative.authenticate.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = () => {
          nativeUnlocks();
          resolve();
        };
      }),
  );
  await render();
  expect(hasText(app, LOCKED)).toBe(true);
  expect(texts(app).join(' ')).not.toContain('Safe combination');
  expect(mockNative.authenticate).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => finish());
  await settle();
  expect(hasText(app, LOCKED)).toBe(false);
  expect(hasText(app, 'Safe combination')).toBe(true);
});

test('a cancelled prompt stays locked quietly; Unlock opens it again', async () => {
  mockNative.authenticate.mockRejectedValueOnce(coded('CANCELLED'));
  await render();
  expect(hasText(app, LOCKED)).toBe(true);
  expect(texts(app).join(' ')).not.toContain('Try again');
  expect(texts(app).join(' ')).not.toContain('Safe combination');

  await pressText(app, 'Unlock');
  expect(mockNative.authenticate).toHaveBeenCalledTimes(2);
  expect(hasText(app, 'Safe combination')).toBe(true);
});

test('Unlock sits low and centered, below the explanation and above the navigation', async () => {
  mockNative.authenticate.mockRejectedValueOnce(coded('CANCELLED'));
  await render();
  const textNode = (text: string) =>
    app.root.find(
      n =>
        n.type === ('Text' as never) &&
        ([] as unknown[]).concat(n.props.children).join('') === text,
    );
  const ancestors = (node: ReactTestInstance) => {
    const list: ReactTestInstance[] = [];
    for (let n = node.parent; n; n = n.parent) {
      if (typeof n.type === 'string') {
        list.push(n);
      }
    }
    return list;
  };
  const style = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style);
  const screen = app.root.find(
    n => typeof n.type === 'string' && n.props.accessibilityViewIsModal,
  );
  // The safe-area mock has no bottom inset: only the thumb-reach margin.
  expect(style(screen).paddingBottom).toBe(spacing.huge);

  const body = textNode('Stash is locked').parent!;
  const button = ancestors(textNode('Unlock'));
  // Not in the centered explanation, but in its own centered area after it.
  expect(button.includes(body)).toBe(false);
  const area = button.find(n => style(n)?.alignSelf === 'center');
  expect(area && style(area)).toMatchObject({ width: '100%', maxWidth: 360 });
  // A direct child of the lock screen (compared as booleans: instances are huge).
  expect(ancestors(area!)[0] === screen).toBe(true);
});

test('failures and lockout are explained and stay locked', async () => {
  mockNative.authenticate
    .mockRejectedValueOnce(coded('FAILED'))
    .mockRejectedValueOnce(coded('LOCKOUT'));
  await render();
  expect(hasText(app, 'Stash couldn’t confirm it’s you. Try again.')).toBe(
    true,
  );
  await pressText(app, 'Unlock');
  expect(
    hasText(
      app,
      'Too many attempts. Wait a moment, then try again, or use your screen lock.',
    ),
  ).toBe(true);
  expect(hasText(app, LOCKED)).toBe(true);
});

test('JavaScript can’t unlock: a prompt that resolves without native unlocking stays locked', async () => {
  mockNative.authenticate.mockResolvedValue(undefined);
  await render();
  await pressText(app, 'Unlock');
  expect(hasText(app, LOCKED)).toBe(true);
  expect(texts(app).join(' ')).not.toContain('Safe combination');
});

test('a later lock covers the mounted app and hides it from accessibility', async () => {
  await render();
  expect(hasText(app, 'Safe combination')).toBe(true);
  mockNative.authenticate.mockRejectedValueOnce(coded('CANCELLED'));
  await nativeLocks();
  expect(hasText(app, LOCKED)).toBe(true);
  const hidden = app.root.findAll(
    n => n.props.importantForAccessibility === 'no-hide-descendants',
  );
  expect(hidden.length).toBeGreaterThan(0);

  await pressText(app, 'Unlock');
  expect(hasText(app, LOCKED)).toBe(false);
  expect(
    app.root.findAll(
      n => n.props.importantForAccessibility === 'no-hide-descendants',
    ),
  ).toHaveLength(0);
});

test('without any credential left, the lock screen offers to turn App Lock off', async () => {
  mockNative.state = {
    enabled: true,
    locked: true,
    availability: 'noCredential',
  };
  mockNative.setEnabled.mockImplementation(async () => {
    mockNative.state = { ...mockNative.state, enabled: false, locked: false };
  });
  await render();
  expect(mockNative.authenticate).not.toHaveBeenCalled();
  await pressText(app, 'Turn off App Lock');
  expect(mockNative.setEnabled).toHaveBeenCalledWith(false);
  expect(hasText(app, 'Safe combination')).toBe(true);
});

describe('Settings', () => {
  async function openSecurity() {
    await render();
    await pressLabel(app, 'Settings');
  }

  const appLockSwitch = () =>
    app.root.find(
      n =>
        n.props.accessibilityLabel === 'App lock' &&
        typeof n.props.onValueChange === 'function',
    );

  test('the switch follows native, and turning it on or off goes through native', async () => {
    mockNative.state = {
      enabled: false,
      locked: false,
      availability: 'available',
    };
    mockNative.setEnabled.mockImplementation(async (enabled: boolean) => {
      mockNative.state = { ...mockNative.state, enabled };
    });
    await openSecurity();
    expect(appLockSwitch().props.value).toBe(false);
    await ReactTestRenderer.act(async () =>
      appLockSwitch().props.onValueChange(true),
    );
    await settle();
    expect(mockNative.setEnabled).toHaveBeenLastCalledWith(true);
    expect(appLockSwitch().props.value).toBe(true);

    // A cancelled prompt changes nothing.
    mockNative.setEnabled.mockRejectedValueOnce(coded('CANCELLED'));
    await ReactTestRenderer.act(async () =>
      appLockSwitch().props.onValueChange(false),
    );
    await settle();
    expect(appLockSwitch().props.value).toBe(true);
  });

  test('without a screen lock it can’t be turned on, and says why', async () => {
    mockNative.state = {
      enabled: false,
      locked: false,
      availability: 'noCredential',
    };
    await openSecurity();
    expect(appLockSwitch().props.disabled).toBe(true);
    expect(hasText(app, 'Set up a screen lock in Android settings first')).toBe(
      true,
    );
  });
});
