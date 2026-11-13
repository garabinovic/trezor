import React from 'react';
import { DeviceEventEmitter, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { ReactTestInstance } from 'react-test-renderer';
import { Screen } from '../../src/components';
import { spacing, ThemeProvider } from '../../src/theme';

// Screen's footer (the editors' Save): fixed below the scroll area, above the
// navigation bar, and right above the keyboard while it is open.
// Portrait by default; landscape tests set the side insets.
const mockInsets = { top: 24, bottom: 32, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

beforeEach(() => {
  mockInsets.left = 0;
  mockInsets.right = 0;
});

let screen: ReactTestRenderer.ReactTestRenderer;

afterEach(() => ReactTestRenderer.act(() => screen.unmount()));

const isHost = (n: ReactTestInstance) => typeof n.type === 'string';
const style = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style) ?? {};

function render() {
  ReactTestRenderer.act(() => {
    screen = ReactTestRenderer.create(
      <ThemeProvider>
        <Screen keyboardAware footer={<Text>Save</Text>}>
          <Text>Last field</Text>
        </Screen>
      </ThemeProvider>,
    );
  });
  const save = screen.root.find(
    n =>
      isHost(n) && n.type === ('Text' as never) && n.props.children === 'Save',
  );
  let footer = save.parent!;
  while (!isHost(footer)) {
    footer = footer.parent!;
  }
  return { save, footer };
}

const keyboard = (event: 'keyboardDidShow' | 'keyboardDidHide') =>
  ReactTestRenderer.act(() => {
    DeviceEventEmitter.emit(event, {
      endCoordinates: { height: 300, screenX: 0, screenY: 500, width: 400 },
    });
  });

test('the footer is outside the scroll area, after it, so it never covers the last field', () => {
  const { save } = render();
  const scroll = screen.root.find(
    n => isHost(n) && n.type === ('RCTScrollView' as never),
  );
  expect(scroll.findAll(n => n === save)).toHaveLength(0);
  expect(
    scroll.findAll(n => n.props.children === 'Last field').length,
  ).toBeGreaterThan(0);
  // The scroll content ends with ordinary spacing; the footer takes the inset.
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingBottom: spacing.lg,
  });
});

test('above the navigation bar, and right above the keyboard while it is open', () => {
  const { footer } = render();
  expect(style(footer).paddingBottom).toBe(32 + spacing.md);
  keyboard('keyboardDidShow');
  expect(style(footer).paddingBottom).toBe(spacing.md);
  keyboard('keyboardDidHide');
  expect(style(footer).paddingBottom).toBe(32 + spacing.md);
});

test('without a footer, scroll content keeps clearing the navigation bar', () => {
  ReactTestRenderer.act(() => {
    screen = ReactTestRenderer.create(
      <ThemeProvider>
        <Screen>
          <Text>Content</Text>
        </Screen>
      </ThemeProvider>,
    );
  });
  const scroll = screen.root.find(
    n => isHost(n) && n.type === ('RCTScrollView' as never),
  );
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingBottom: 32 + spacing.xxxl,
  });
});

test('on a tab screen the footer adds no navigation inset (the tab bar clears it)', () => {
  ReactTestRenderer.act(() => {
    screen = ReactTestRenderer.create(
      <ThemeProvider>
        <Screen bottomInset={false} footer={<Text>Search</Text>}>
          <Text>Content</Text>
        </Screen>
      </ThemeProvider>,
    );
  });
  let footer = screen.root.find(
    n =>
      isHost(n) &&
      n.type === ('Text' as never) &&
      n.props.children === 'Search',
  ).parent!;
  while (!isHost(footer)) {
    footer = footer.parent!;
  }
  expect(style(footer).paddingBottom).toBe(spacing.md);
});

describe('landscape: the system navigation on either side', () => {
  /** The screen body, the overlay's frame and a header action. */
  function layout() {
    ReactTestRenderer.act(() => {
      screen = ReactTestRenderer.create(
        <ThemeProvider>
          <Screen
            header={<Text accessibilityLabel="Settings">S</Text>}
            overlay={<Text>Add</Text>}
          >
            <Text>Content</Text>
          </Screen>
        </ThemeProvider>,
      );
    });
    const body = screen.root.find(
      n => isHost(n) && style(n).paddingTop === mockInsets.top,
    );
    let overlayFrame = screen.root.find(
      n => isHost(n) && n.props.children === 'Add',
    ).parent!;
    while (!isHost(overlayFrame)) {
      overlayFrame = overlayFrame.parent!;
    }
    const action = screen.root.find(
      n => isHost(n) && n.props.accessibilityLabel === 'Settings',
    );
    return { body, overlayFrame, action };
  }

  test.each([
    ['right', 0, 48],
    ['left', 48, 0],
    ['portrait (none)', 0, 0],
  ])('navigation on the %s', (_, left, right) => {
    mockInsets.left = left;
    mockInsets.right = right;
    const { body, overlayFrame, action } = layout();
    // Header actions, content and footer sit inside the safe edges…
    expect(style(body)).toMatchObject({
      paddingLeft: left,
      paddingRight: right,
    });
    expect(body.findAll(n => n === action)).toHaveLength(1);
    // …and so does the floating Add button, which lets touches through around it.
    expect(style(overlayFrame)).toMatchObject({ left, right });
    expect(overlayFrame.props.pointerEvents).toBe('box-none');
  });
});
