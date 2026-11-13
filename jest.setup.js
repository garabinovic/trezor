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
          : name === 'appVersion'
          ? jest.fn(() => '{"versionName":"1.0.0","versionCode":2}')
          : jest.fn(async () => {
              throw Object.assign(new Error('native backup in Jest'), {
                code: 'BACKUP_FAILED',
              });
            }),
    },
  ),
}));

// The app language is stored natively; this fake keeps it in memory for the
// test file (reset with __reset). New installations start in English.
jest.mock('./src/native/NativeTrezorLocale', () => {
  const store = { language: 'en', texts: {} };
  return {
    __esModule: true,
    default: {
      store,
      getLanguage: jest.fn(() => store.language),
      setLanguage: jest.fn(async (language, textsJson) => {
        store.language = language;
        store.texts = JSON.parse(textsJson);
      }),
      __reset() {
        store.language = 'en';
        store.texts = {};
      },
    },
  };
});

// App Lock is native; by default it is off (tests of the lock mock this).
jest.mock('./src/native/NativeTrezorAppLock', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(
      () => '{"enabled":false,"locked":false,"availability":"available"}',
    ),
    authenticate: jest.fn(async () => undefined),
    setEnabled: jest.fn(async () => undefined),
    confirm: jest.fn(async () => undefined),
  },
}));

// SQLCipher is native-only. Tests that use SQL mock it themselves (with
// test-utils/fakeSqlCipher or node:sqlite), which replaces this.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => {
    throw new Error('native SQLCipher in Jest');
  },
  isSQLCipher: () => true,
  ANDROID_DATABASE_PATH: '/data/user/0/com.trezor.app/databases/',
}));

// Restore is native-only; flow tests pass a fake platform. Startup recovery
// finds nothing to recover (no journal), as on a device that never restored.
const mockRecoveryIdle = {
  recoveryBegin: async () => 'recovery-jest',
  recoveryRun: async () => '{"status":"done"}',
  recoveryEnd: async () => undefined,
};
jest.mock('./src/native/NativeTrezorRestore', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get: (_, name) =>
        name === '__esModule'
          ? undefined
          : jest.fn(
              mockRecoveryIdle[name] ??
                (async () => {
                  throw Object.assign(new Error('native restore in Jest'), {
                    code: 'RESTORE_FAILED',
                  });
                }),
            ),
    },
  ),
}));
