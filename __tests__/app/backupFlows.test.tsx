import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../../App';
import type { DocumentItem } from '../../src/data/types';
import { runMigrations } from '../../src/storage/migrations';
import { SqliteItemRepository } from '../../src/storage/SqliteItemRepository';
import type { SqlDatabase } from '../../src/storage/sql';
import { gutter } from '../../src/theme';
import {
  hasText,
  insetLeft,
  pressLabel,
  pressText,
  settle,
  texts,
  typeInto,
} from '../../test-utils/appHarness';
import { createNodeSqliteDatabase } from '../../test-utils/nodeSqlite';

// Phase 6 Step 5: the backup, Check and restore screens on the real app. The
// operations themselves (createBackup, checkBackup, restoreBackup, the native
// pickers and preflight) are replaced by recording fakes; their own suites
// (backup.test.ts, restore.test.ts, recovery.test.ts) cover what they do.
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

const mockCreateBackup = jest.fn();
const mockCheckBackup = jest.fn();
jest.mock('../../src/backup/backup', () => ({
  createBackup: (o: unknown) => mockCreateBackup(o),
  checkBackup: (o: unknown) => mockCheckBackup(o),
}));

const mockRestoreBackup = jest.fn();
const mockRetryCleanup = jest.fn();
let mockCleanupPending = false;
jest.mock('../../src/backup/restore', () => ({
  ...jest.requireActual('../../src/backup/restore'),
  restoreBackup: (o: unknown) => mockRestoreBackup(o),
  restoreCleanupPending: () => mockCleanupPending,
  retryRestoreCleanup: () => mockRetryCleanup(),
}));

const mockPreflight = jest.fn();
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

const mockPickBackupFile = jest.fn();
const mockIncompleteNotice = jest.fn();
jest.mock('../../src/backup/platform', () => {
  const actual = jest.requireActual('../../src/backup/platform');
  return {
    ...actual,
    nativeBackupPlatform: {
      ...actual.nativeBackupPlatform,
      pickBackupFile: () => mockPickBackupFile(),
      takeIncompleteNotice: () => mockIncompleteNotice(),
    },
  };
});

const { BackupError } = jest.requireActual('../../src/backup/platform');
const { RestoreError } = jest.requireActual('../../src/backup/restorePlatform');

const DOC_ID = 'doc-1';
const FILE_ID = '01a1a0dd-991f-783c-9531-3fab9ef47901';
const doc: DocumentItem = {
  id: DOC_ID,
  type: 'document',
  title: 'Boiler warranty',
  kind: 'warranty',
  merchant: '',
  date: null,
  expiresOn: null,
  amount: null,
  currency: '',
  notes: '',
  attachments: [
    {
      id: FILE_ID,
      fileName: 'warranty.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'a'.repeat(64),
      formatVersion: 1,
      createdAt: '2026-11-03T00:00:00.000Z',
    },
  ],
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

let app: ReactTestRenderer.ReactTestRenderer;

beforeEach(async () => {
  jest.clearAllMocks();
  mockCleanupPending = false;
  mockIncompleteNotice.mockResolvedValue(null);
  mockPreflight.mockResolvedValue({ status: 'ready' });
  mockPickBackupFile.mockResolvedValue('content://backups/one.tzbk');
  mockDb = createNodeSqliteDatabase();
  await runMigrations(mockDb);
  await new SqliteItemRepository(mockDb).save(doc);
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
});

afterEach(() => {
  ReactTestRenderer.act(() => app.unmount());
});

/** The visible screen offers no way back (hidden screens below keep their headers). */
async function expectNoBack() {
  await expect(pressLabel(app, 'Back')).rejects.toThrow('Label not found');
}

async function openSettingsEntry(title: string) {
  await pressLabel(app, 'Settings');
  await pressText(app, title);
}

/** A promise the test settles by hand, to look at the screen meanwhile. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Back up to a file', () => {
  test('a password entered twice, a blocking screen, then success only once verified', async () => {
    const run = deferred<unknown>();
    mockCreateBackup.mockReturnValue(run.promise);
    await openSettingsEntry('Back up to a file');
    await typeInto(app, 'Backup password', 'correct horse battery');
    await typeInto(app, 'Repeat password', 'correct horse battery');
    await pressText(app, 'Choose where to save');

    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
    const options = mockCreateBackup.mock.calls[0][0];
    expect(options.password).toBe('correct horse battery');
    expect(options.confirmation).toBe('correct horse battery');
    expect(options.suggestedName).toMatch(
      /^Trezor backup \d{4}-\d{2}-\d{2}\.tzbk$/,
    );
    expect(typeof options.database.exclusive).toBe('function');
    // Blocking: progress only, no way back while the gate may be held.
    expect(hasText(app, 'Backing up…')).toBe(true);
    await expectNoBack();

    await ReactTestRenderer.act(async () =>
      run.resolve({ status: 'created', bytes: 3 * 1024 * 1024, backupId: 'b' }),
    );
    await settle();
    expect(hasText(app, 'Backup saved and verified')).toBe(true);
    expect(texts(app).join(' ')).toContain('3.0 MB');
    // Done: back to Settings again.
    await pressLabel(app, 'Back');
    expect(hasText(app, 'Back up to a file')).toBe(true);
  });

  test('a cancelled picker returns to the form; errors are explained there', async () => {
    await openSettingsEntry('Back up to a file');
    await typeInto(app, 'Backup password', 'short');
    await typeInto(app, 'Repeat password', 'short');

    mockCreateBackup.mockResolvedValueOnce({ status: 'cancelled' });
    await pressText(app, 'Choose where to save');
    expect(hasText(app, 'Choose where to save')).toBe(true);

    const cases: [unknown, string][] = [
      [
        new BackupError('PASSWORD_LENGTH'),
        'The password must be 10 to 256 characters long.',
      ],
      [new BackupError('PASSWORD_MISMATCH'), 'The two passwords don’t match.'],
      [
        new BackupError('DESTINATION_NOT_EMPTY', undefined, 'none'),
        'The chosen file isn’t empty. Choose a new file name instead.',
      ],
      [
        new BackupError('DESTINATION_UNVERIFIED', undefined, 'remains'),
        'Trezor couldn’t verify the backup in that location. Choose a folder on this device’s own storage instead (in the file picker’s menu, the device’s name), then copy the backup wherever you like. An incomplete file may remain where you saved it; delete it there.',
      ],
      [
        new BackupError('BACKUP_ATTACHMENT_UNREADABLE', {
          attachmentId: FILE_ID,
          itemId: DOC_ID,
          reason: 'DAMAGED',
        }),
        'The file “warranty.pdf” in “Boiler warranty” is damaged. Open the item, remove or replace the file, then back up again.',
      ],
      [
        new BackupError('BACKUP_ATTACHMENT_UNREADABLE', {
          attachmentId: 'gone',
          itemId: 'gone-item',
          reason: 'MISSING',
        }),
        'An attached file is missing. Open the item, remove or replace the file, then back up again.',
      ],
      [
        Object.assign(new Error('x'), { code: 'WEIRD' }),
        'Something went wrong. Nothing was changed.',
      ],
    ];
    for (const [error, message] of cases) {
      mockCreateBackup.mockRejectedValueOnce(error);
      await pressText(app, 'Choose where to save');
      expect(hasText(app, message)).toBe(true);
    }
  });
});

describe('Password fields and layout', () => {
  /** The visible password input with this label. */
  const input = (label: string) =>
    app.root.find(
      n =>
        n.type === ('TextInput' as never) &&
        n.props.accessibilityLabel === label,
    );
  /** The show/hide buttons, in field order. */
  const eyes = () =>
    app.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        /^(Show|Hide) password$/.test(n.props.accessibilityLabel ?? ''),
    );
  const pressEye = async (index: number) => {
    await ReactTestRenderer.act(async () => eyes()[index].props.onPress());
    await settle();
  };

  test('hidden by default; Show and Hide toggle each field without changing what was typed', async () => {
    await openSettingsEntry('Back up to a file');
    for (const label of ['Backup password', 'Repeat password']) {
      expect(input(label).props).toMatchObject({
        secureTextEntry: true,
        keyboardType: 'default',
        autoCapitalize: 'none',
        autoCorrect: false,
        multiline: false,
      });
    }
    expect(eyes().map(e => e.props.accessibilityLabel)).toEqual([
      'Show password',
      'Show password',
    ]);
    await typeInto(app, 'Backup password', 'correct horse battery');
    await typeInto(app, 'Repeat password', 'correct horse battery');

    await pressEye(0);
    expect(input('Backup password').props).toMatchObject({
      secureTextEntry: false,
      // Android: no suggestions or learning while the text is shown.
      keyboardType: 'visible-password',
      value: 'correct horse battery',
    });
    expect(input('Repeat password').props.secureTextEntry).toBe(true);
    expect(eyes()[0].props.accessibilityLabel).toBe('Hide password');

    await pressEye(1);
    expect(input('Repeat password').props).toMatchObject({
      secureTextEntry: false,
      value: 'correct horse battery',
    });

    await pressEye(0);
    expect(input('Backup password').props).toMatchObject({
      secureTextEntry: true,
      keyboardType: 'default',
      value: 'correct horse battery',
    });
    expect(eyes()[0].props.accessibilityLabel).toBe('Show password');
    // The text is shown only in the field itself.
    expect(texts(app).join(' ')).not.toContain('correct horse battery');

    mockCreateBackup.mockReturnValue(new Promise(() => undefined));
    await pressText(app, 'Choose where to save');
    expect(mockCreateBackup.mock.calls[0][0]).toMatchObject({
      password: 'correct horse battery',
      confirmation: 'correct horse battery',
    });
  });

  test('Check and Restore fields can be shown too, hidden again when reopened', async () => {
    await openSettingsEntry('Check a backup');
    await typeInto(app, 'Backup password', 'abc');
    await pressEye(0);
    expect(input('Backup password').props).toMatchObject({
      secureTextEntry: false,
      value: 'abc',
    });
    await pressLabel(app, 'Back');
    await pressText(app, 'Restore from a backup');
    expect(input('Backup password').props.secureTextEntry).toBe(true);
    await pressEye(0);
    expect(input('Backup password').props.secureTextEntry).toBe(false);
  });

  test('fields and buttons sit inside the app gutter, not edge to edge', async () => {
    const screens: [string, string][] = [
      ['Back up to a file', 'Choose where to save'],
      ['Check a backup', 'Choose backup file'],
      ['Restore from a backup', 'Choose backup file'],
    ];
    await pressLabel(app, 'Settings');
    for (const [entry, button] of screens) {
      await pressText(app, entry);
      const buttonText = app.root
        .findAll(
          n =>
            n.type === ('Text' as never) &&
            ([] as unknown[]).concat(n.props.children).join('') === button,
        )
        .pop()!;
      let pressable = buttonText.parent;
      while (pressable && pressable.props.accessibilityRole !== 'button') {
        pressable = pressable.parent;
      }
      expect([
        entry,
        insetLeft(input('Backup password')),
        insetLeft(pressable!),
      ]).toEqual([entry, gutter, gutter]);
      await pressLabel(app, 'Back');
    }
  });
});

describe('Check a backup', () => {
  test('valid, wrong password and damaged files', async () => {
    await openSettingsEntry('Check a backup');
    await typeInto(app, 'Backup password', 'correct horse battery');

    mockCheckBackup.mockRejectedValueOnce(
      new BackupError('BACKUP_PASSWORD_OR_HEADER'),
    );
    await pressText(app, 'Choose backup file');
    expect(
      hasText(
        app,
        'The password is wrong, or this isn’t a Trezor backup file.',
      ),
    ).toBe(true);

    mockCheckBackup.mockRejectedValueOnce(new BackupError('BACKUP_CORRUPT'));
    await pressText(app, 'Choose backup file');
    expect(
      hasText(
        app,
        'The backup file is damaged or incomplete. It can’t be used.',
      ),
    ).toBe(true);

    mockCheckBackup.mockResolvedValueOnce({
      status: 'valid',
      backupId: 'b',
      trailer: 't',
      attachments: 2,
    });
    await pressText(app, 'Choose backup file');
    expect(mockCheckBackup).toHaveBeenLastCalledWith({
      password: 'correct horse battery',
    });
    expect(hasText(app, 'The backup is complete')).toBe(true);
    expect(texts(app).join(' ')).toContain('including 2 attached files');
  });
});

describe('Restore from a backup', () => {
  async function fillRestoreForm() {
    await openSettingsEntry('Restore from a backup');
    expect(mockPreflight).toHaveBeenCalledWith(false);
    await pressText(app, 'Choose backup file');
    await typeInto(app, 'Backup password', 'correct horse battery');
    await pressText(app, 'Restore');
  }

  test('Replace-only confirmation, then the blocking screen; from the swap on it never returns', async () => {
    mockRestoreBackup.mockImplementation(
      async (o: { onPrepared: (p: unknown, l: unknown) => Promise<void> }) => {
        await o.onPrepared({}, undefined);
        return new Promise(() => undefined);
      },
    );
    await fillRestoreForm();
    // Nothing starts before the confirmation.
    expect(hasText(app, 'Replace all data?')).toBe(true);
    expect(mockRestoreBackup).not.toHaveBeenCalled();
    await pressText(app, 'Replace');

    const options = mockRestoreBackup.mock.calls[0][0];
    expect(options.uri).toBe('content://backups/one.tzbk');
    expect(options.password).toBe('correct horse battery');
    expect(typeof options.database.exclusive).toBe('function');
    expect(typeof options.firedOnceIds).toBe('function');
    expect(hasText(app, 'Finishing the restore…')).toBe(true);
    expect(texts(app).join(' ')).toContain(
      'Restore isn’t finished yet. Close and reopen Trezor to complete it.',
    );
    await expectNoBack();
  });

  test('dismissing the confirmation starts nothing', async () => {
    await fillRestoreForm();
    await pressText(app, 'Cancel');
    expect(hasText(app, 'Replace all data?')).toBe(false);
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });

  test('a failure before the swap returns to the form with the reason', async () => {
    mockRestoreBackup.mockRejectedValueOnce(
      new RestoreError('BACKUP_PASSWORD_OR_HEADER'),
    );
    await fillRestoreForm();
    await pressText(app, 'Replace');
    expect(
      hasText(
        app,
        'The password is wrong, or this isn’t a Trezor backup file.',
      ),
    ).toBe(true);
    // The password is cleared; the file stays chosen.
    expect(hasText(app, 'Backup file chosen.')).toBe(true);

    mockRestoreBackup.mockRejectedValueOnce(new RestoreError('BACKUP_CORRUPT'));
    await typeInto(app, 'Backup password', 'correct horse battery');
    await pressText(app, 'Restore');
    await pressText(app, 'Replace');
    expect(
      hasText(
        app,
        'The backup file is damaged or incomplete. It can’t be used.',
      ),
    ).toBe(true);
  });

  test('a share in progress asks to wait or cancel', async () => {
    let answer: string | undefined;
    mockRestoreBackup.mockImplementation(
      async (o: { whileSharesActive: (n: number) => Promise<string> }) => {
        answer = await o.whileSharesActive(1);
        throw new RestoreError('RESTORE_CANCELLED');
      },
    );
    await fillRestoreForm();
    await pressText(app, 'Replace');
    expect(hasText(app, 'A file is still being shared')).toBe(true);
    await pressText(app, 'Cancel restore');
    expect(answer).toBe('cancel');
    expect(
      hasText(app, 'The restore was cancelled. Nothing was changed.'),
    ).toBe(true);
  });

  test('a failed cleanup keeps the screen until a retry finishes it', async () => {
    mockRestoreBackup.mockRejectedValueOnce(
      new RestoreError('RESTORE_RECOVERY_RETRY', false),
    );
    mockRetryCleanup
      .mockRejectedValueOnce(new RestoreError('RESTORE_RECOVERY_RETRY', false))
      .mockResolvedValueOnce(undefined);
    await fillRestoreForm();
    await pressText(app, 'Replace');
    expect(hasText(app, 'Try again')).toBe(true);
    await expectNoBack();
    await pressText(app, 'Try again');
    expect(hasText(app, 'Try again')).toBe(true);
    await pressText(app, 'Try again');
    expect(mockRetryCleanup).toHaveBeenCalledTimes(2);
    expect(
      hasText(app, 'The restore was stopped. Your data is as it was before.'),
    ).toBe(true);
    await pressLabel(app, 'Back');
    expect(hasText(app, 'Restore from a backup')).toBe(true);
  });

  test('preconditions that refuse a restore say why and start nothing', async () => {
    mockPreflight.mockResolvedValueOnce({
      status: 'refused',
      code: 'RESTORE_UNAVAILABLE',
    });
    await openSettingsEntry('Restore from a backup');
    expect(
      hasText(
        app,
        'Restoring isn’t possible: the encryption key on this device is missing or no longer valid. Nothing was changed.',
      ),
    ).toBe(true);
    expect(hasText(app, 'Choose backup file')).toBe(false);
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });
});

test('an incomplete backup file left by an earlier run is reported once', async () => {
  ReactTestRenderer.act(() => app.unmount());
  mockIncompleteNotice.mockResolvedValueOnce('Trezor backup 2026-11-09.tzbk');
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  await settle();
  expect(hasText(app, 'An incomplete backup file may remain')).toBe(true);
  expect(texts(app).join(' ')).toContain('Trezor backup 2026-11-09.tzbk');
  await pressText(app, 'OK');
  expect(hasText(app, 'An incomplete backup file may remain')).toBe(false);
});
