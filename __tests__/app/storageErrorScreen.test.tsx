import React from 'react';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  RestoreCancel,
  StorageErrorScreen,
} from '../../src/screens/StorageErrorScreen';
import { StorageError, StorageErrorCode } from '../../src/storage/errors';
import { gutter, ThemeProvider } from '../../src/theme';
import { insetLeft, settle } from '../../test-utils/appHarness';

const mockPreflight = jest.fn();
const mockRestoreBackup = jest.fn();
const mockPickBackupFile = jest.fn();
jest.mock('../../src/backup/restorePlatform', () => {
  const actual = jest.requireActual('../../src/backup/restorePlatform');
  return {
    ...actual,
    nativeRestorePlatform: {
      ...actual.nativeRestorePlatform,
      preflight: (fromErrorScreen: boolean) => mockPreflight(fromErrorScreen),
    },
  };
});
jest.mock('../../src/backup/restore', () => ({
  ...jest.requireActual('../../src/backup/restore'),
  restoreBackup: (o: unknown) => mockRestoreBackup(o),
}));
jest.mock('../../src/backup/platform', () => {
  const actual = jest.requireActual('../../src/backup/platform');
  return {
    ...actual,
    nativeBackupPlatform: {
      ...actual.nativeBackupPlatform,
      pickBackupFile: () => mockPickBackupFile(),
    },
  };
});

// The storage-error screen's Cancel restore action (Phase 6 spec v2.5 §2.3,
// decision D2): only for RESTORE_VERIFY_RETRY, only when available, and only
// after a confirmation. Retry stays.
const CANCEL = 'Cancel restore and return to previous data';
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(
  code: StorageErrorCode,
  restoreCancel: RestoreCancel,
  onRetry = jest.fn(),
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <StorageErrorScreen
            error={new StorageError(code, 'x')}
            onRetry={onRetry}
            restoreCancel={restoreCancel}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  const buttons = (label: string) =>
    renderer.root.findAll(
      (n: ReactTestInstance) =>
        n.props.label === label && typeof n.props.onPress === 'function',
    );
  const press = async (label: string) => {
    await ReactTestRenderer.act(async () => {
      buttons(label)[0].props.onPress();
    });
    await settle();
  };
  const dialogVisible = () =>
    renderer.root.findAll(
      (n: ReactTestInstance) =>
        n.props.title === 'Cancel restore?' && n.props.visible === true,
    ).length > 0;
  return { renderer, buttons, press, dialogVisible, onRetry };
}

const cancel = (available: boolean) => ({
  available: jest.fn(async () => available),
  cancel: jest.fn(async () => undefined),
});

test('offered after RESTORE_VERIFY_RETRY when the previous data checks out; cancelled only after confirming', async () => {
  const restoreCancel = cancel(true);
  const screen = render('RESTORE_VERIFY_RETRY', restoreCancel);
  await settle();
  expect(screen.buttons('Try again')).toHaveLength(1);
  expect(screen.buttons(CANCEL)).toHaveLength(1);

  // Dismissing the confirmation changes nothing.
  await screen.press(CANCEL);
  expect(screen.dialogVisible()).toBe(true);
  await screen.press('Cancel');
  expect(screen.dialogVisible()).toBe(false);
  expect(restoreCancel.cancel).not.toHaveBeenCalled();

  // Confirming cancels, then retries (recovery rolls back).
  await screen.press(CANCEL);
  await screen.press('Return to previous data');
  expect(restoreCancel.cancel).toHaveBeenCalledTimes(1);
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
});

test('not offered when the previous data fails its check, or for any other code', async () => {
  const unavailable = cancel(false);
  const screen = render('RESTORE_VERIFY_RETRY', unavailable);
  await settle();
  expect(screen.buttons(CANCEL)).toHaveLength(0);
  expect(screen.buttons('Try again')).toHaveLength(1);

  for (const code of [
    'RESTORE_STATE_UNKNOWN',
    'RESTORE_RECOVERY_RETRY',
    'RESTORE_UNAVAILABLE',
    'RESTORE_IN_PROGRESS',
    'DATABASE_CORRUPT',
  ] as StorageErrorCode[]) {
    const offered = cancel(true);
    const other = render(code, offered);
    await settle();
    expect([code, other.buttons(CANCEL).length]).toEqual([code, 0]);
    expect(offered.available).not.toHaveBeenCalled();
  }
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const until = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { until, resolve, reject };
};

const disabled = (screen: ReturnType<typeof render>, label: string) =>
  screen.buttons(label)[0].props.disabled === true;

test('Retry is disabled while the Cancel availability check runs', async () => {
  const check = deferred<boolean>();
  const restoreCancel = {
    available: jest.fn(() => check.until),
    cancel: jest.fn(async () => undefined),
  };
  const screen = render('RESTORE_VERIFY_RETRY', restoreCancel);
  await settle();
  expect(disabled(screen, 'Try again')).toBe(true);
  // Even a press that reaches it does nothing.
  await screen.press('Try again');
  expect(screen.onRetry).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => check.resolve(true));
  await settle();
  expect(disabled(screen, 'Try again')).toBe(false);
  await screen.press('Try again');
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
});

test('while the confirmed cancel runs, Retry and Cancel are disabled and a second confirmation starts nothing', async () => {
  const running = deferred<void>();
  const restoreCancel = {
    available: jest.fn(async () => true),
    cancel: jest.fn(() => running.until),
  };
  const screen = render('RESTORE_VERIFY_RETRY', restoreCancel);
  await settle();
  await screen.press(CANCEL);
  const confirm = screen.renderer.root.find(
    (n: ReactTestInstance) => n.props.title === 'Cancel restore?',
  ).props.onConfirm;
  await ReactTestRenderer.act(async () => {
    confirm();
    confirm();
  });
  await settle();
  expect(restoreCancel.cancel).toHaveBeenCalledTimes(1);
  expect(screen.dialogVisible()).toBe(false);
  expect(disabled(screen, 'Try again')).toBe(true);
  expect(disabled(screen, CANCEL)).toBe(true);
  await screen.press('Try again');
  expect(screen.onRetry).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => running.resolve());
  await settle();
  // Done: the next recovery run rolls back.
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
});

test('a failed cancel leaves nothing disabled, checks availability again and does not retry by itself', async () => {
  const restoreCancel = cancel(true);
  restoreCancel.cancel.mockRejectedValueOnce(new Error('changed'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const screen = render('RESTORE_VERIFY_RETRY', restoreCancel);
  await settle();
  await screen.press(CANCEL);
  await screen.press('Return to previous data');
  expect(warn).toHaveBeenCalledWith('[restore] cancel not possible');
  expect(screen.onRetry).not.toHaveBeenCalled();
  expect(restoreCancel.available).toHaveBeenCalledTimes(2);
  expect(disabled(screen, 'Try again')).toBe(false);
  expect(disabled(screen, CANCEL)).toBe(false);
  // And it can be tried again, once.
  await screen.press(CANCEL);
  await screen.press('Return to previous data');
  expect(restoreCancel.cancel).toHaveBeenCalledTimes(2);
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

// Phase 6 Step 5, spec v2.4 §8.1: the restore entry depends on the code.
const RESTORE = 'Restore from a backup';
const screenText = (screen: ReturnType<typeof render>) =>
  JSON.stringify(screen.renderer.toJSON());

test('Restore from a backup is offered for unreadable data only; key errors say it is unavailable', async () => {
  for (const code of [
    'DATABASE_UNREADABLE',
    'DATABASE_CORRUPT',
    'MIGRATION_FAILED',
    'SNAPSHOT_FAILED',
  ] as StorageErrorCode[]) {
    const screen = render(code, cancel(false));
    await settle();
    expect([code, screen.buttons(RESTORE).length]).toEqual([code, 1]);
    expect(screen.buttons('Try again')).toHaveLength(1);
  }
  for (const code of [
    'KEY_MISSING_FOR_DATABASE',
    'MASTER_KEY_MISSING',
    'UNWRAP_FAILED',
    'KEY_INVALIDATED',
    'KEY_NOT_FOUND',
    'INVALID_KEY_FORMAT',
  ] as StorageErrorCode[]) {
    const screen = render(code, cancel(false));
    await settle();
    expect([code, screen.buttons(RESTORE).length]).toEqual([code, 0]);
    expect(screenText(screen)).toContain('RESTORE_UNAVAILABLE');
  }
  for (const code of [
    'NEWER_SCHEMA',
    'STORAGE_ERROR',
    'WRITE_FAILED',
    'RESTORE_STATE_UNKNOWN',
    'RESTORE_VERIFY_RETRY',
  ] as StorageErrorCode[]) {
    const screen = render(code, cancel(false));
    await settle();
    expect([code, screen.buttons(RESTORE).length]).toEqual([code, 0]);
  }
});

test('restoring from the error screen runs without a live database, and Cancel goes back', async () => {
  mockPreflight.mockResolvedValue({ status: 'ready' });
  mockPickBackupFile.mockResolvedValue('content://backups/one.tzbk');
  mockRestoreBackup.mockReturnValue(new Promise(() => undefined));
  const screen = render('DATABASE_CORRUPT', cancel(false));
  await settle();
  await screen.press(RESTORE);
  expect(mockPreflight).toHaveBeenCalledWith(true);
  // The Retry screen is replaced by the restore form.
  expect(screen.buttons('Try again')).toHaveLength(0);
  await screen.press('Cancel');
  expect(screen.buttons(RESTORE)).toHaveLength(1);

  await screen.press(RESTORE);
  await screen.press('Choose backup file');
  const input = screen.renderer.root.find(
    (n: ReactTestInstance) =>
      n.props.accessibilityLabel === 'Backup password' &&
      typeof n.props.onChangeText === 'function',
  );
  // The error screen's own gutter, not a second one.
  expect(insetLeft(input)).toBe(gutter);
  await ReactTestRenderer.act(async () =>
    input.props.onChangeText('correct horse battery'),
  );
  await screen.press('Restore');
  await screen.press('Replace');
  const options = mockRestoreBackup.mock.calls[0][0];
  expect(options.database).toBeUndefined();
  expect(options.firedOnceIds).toBeUndefined();
  expect(options.uri).toBe('content://backups/one.tzbk');
  expect(screenText(screen)).toContain('Restoring…');
});
