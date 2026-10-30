/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// Native SQLCipher is not available in Jest; open in-memory storage instead.
jest.mock('../src/storage/openStorage', () => ({
  openStorage: async () => ({
    items:
      new (require('../src/storage/ItemRepository').InMemoryItemRepository)(),
    settings:
      new (require('../src/storage/SettingsRepository').InMemorySettingsRepository)(),
    initialItems: [],
    initialTheme: 'system',
  }),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
