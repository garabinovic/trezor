/* eslint-env jest */
// The Keystore vault is native-only; Jest uses Node's CSPRNG instead.
jest.mock('./src/native/NativeTrezorVault', () => ({
  __esModule: true,
  default: {
    randomBytesHex: length =>
      require('crypto').randomBytes(length).toString('hex'),
    hasKey: jest.fn(),
    createKey: jest.fn(),
    getKey: jest.fn(),
    getMasterKeySecurityLevel: jest.fn(),
  },
}));

// The reminder scheduler is native-only; tests inspect a recording fake.
jest.mock('./src/native/NativeTrezorReminders', () => ({
  __esModule: true,
  default: require('./test-utils/fakeReminders').fakeReminders.module,
}));

// Encrypted attachment files are native-only; tests use an in-memory fake.
jest.mock('./src/native/NativeTrezorAttachments', () => ({
  __esModule: true,
  default: require('./test-utils/fakeAttachments').fakeAttachments.module,
}));

// Backup creation and Check backup are native-only; flow tests pass a fake platform.
jest.mock('./src/native/NativeTrezorBackup', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get: (_, name) =>
        name === '__esModule'
          ? undefined
          : jest.fn(async () => {
              throw Object.assign(new Error('native backup in Jest'), {
                code: 'BACKUP_FAILED',
              });
            }),
    },
  ),
}));

// Restore preparation is native-only; flow tests pass a fake platform.
jest.mock('./src/native/NativeTrezorRestore', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get: (_, name) =>
        name === '__esModule'
          ? undefined
          : jest.fn(async () => {
              throw Object.assign(new Error('native restore in Jest'), {
                code: 'RESTORE_FAILED',
              });
            }),
    },
  ),
}));
