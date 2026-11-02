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
