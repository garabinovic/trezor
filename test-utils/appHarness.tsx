// Test-only helpers to drive the whole app (navigation, screens, providers)
// with react-test-renderer. Storage is the real SQLite repository code on a
// node:sqlite database; only the SQLCipher open step is replaced (see the
// openStorage mock in each test file).
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';

export async function settle(ms = 30) {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
  });
}

/** Host components (Text, TextInput, RNSScreen…) have string types at runtime. */
const hostType = (node: ReactTestInstance) => node.type as unknown as string;

function textOf(node: ReactTestInstance): string {
  const children = ([] as unknown[]).concat(node.props.children);
  return children
    .map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');
}

/** Nearest enclosing RNSScreen or RNSScreenStack. */
function nearestContainer(node: ReactTestInstance): ReactTestInstance | null {
  let current = node.parent;
  while (
    current &&
    hostType(current) !== 'RNSScreenStack' &&
    hostType(current) !== 'RNSScreen'
  ) {
    current = current.parent;
  }
  return current;
}

/**
 * Inactive screens stay mounted in tests: tabs mark them with
 * activityState 0, and a native stack only shows its last screen.
 */
function isVisible(node: ReactTestInstance): boolean {
  let screen: ReactTestInstance | null = null;
  let current: ReactTestInstance | null = node;
  while (current) {
    if (hostType(current) === 'RNSScreen') {
      if (current.props.activityState === 0) {
        return false;
      }
      screen = current;
    }
    if (hostType(current) === 'RNSScreenStack' && screen) {
      const stack = current;
      const screens = stack.findAll(
        n => hostType(n) === 'RNSScreen' && nearestContainer(n) === stack,
      );
      if (screens[screens.length - 1] !== screen) {
        return false;
      }
    }
    current = current.parent;
  }
  return true;
}

function visibleTextNodes(r: Renderer): ReactTestInstance[] {
  return r.root.findAll(n => hostType(n) === 'Text').filter(isVisible);
}

/** Text strings on the screen the user currently sees (host <Text> nodes). */
export function texts(r: Renderer): string[] {
  return visibleTextNodes(r).map(textOf).filter(Boolean);
}

export function hasText(r: Renderer, text: string): boolean {
  return texts(r).includes(text);
}

function pressable(node: ReactTestInstance): ReactTestInstance | null {
  let current: ReactTestInstance | null = node;
  while (current) {
    if (typeof current.props.onPress === 'function') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

async function pressNode(node: ReactTestInstance | null, what: string) {
  if (!node) {
    throw new Error(`Nothing pressable for ${what}`);
  }
  if (node.props.disabled) {
    throw new Error(`${what} is disabled`);
  }
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
}

/** Presses the nearest pressable ancestor of the last matching text. */
export async function pressText(r: Renderer, text: string) {
  const nodes = visibleTextNodes(r).filter(n => textOf(n) === text);
  if (nodes.length === 0) {
    throw new Error(`Text not found: "${text}"`);
  }
  await pressNode(pressable(nodes[nodes.length - 1]), `"${text}"`);
}

/** Presses the element with this accessibility label (prefix match allowed). */
export async function pressLabel(
  r: Renderer,
  label: string,
  { prefix = false } = {},
) {
  const nodes = r.root.findAll(
    n =>
      isVisible(n) &&
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (prefix
        ? n.props.accessibilityLabel.startsWith(label)
        : n.props.accessibilityLabel === label),
  );
  if (nodes.length === 0) {
    throw new Error(`Label not found: "${label}"`);
  }
  await pressNode(nodes[0], `"${label}"`);
}

/** Bottom tab by its label (React Navigation labels tabs "Notes, tab, 2 of 5"). */
export async function openTab(r: Renderer, name: string) {
  await pressLabel(r, `${name}, tab`, { prefix: true });
}

/** Types into the TextInput with this accessibility label. */
export async function typeInto(r: Renderer, label: string, value: string) {
  const inputs = r.root.findAll(
    n =>
      isVisible(n) &&
      hostType(n) === 'TextInput' &&
      n.props.accessibilityLabel === label &&
      typeof n.props.onChangeText === 'function',
  );
  if (inputs.length === 0) {
    throw new Error(`Input not found: "${label}"`);
  }
  await ReactTestRenderer.act(async () => {
    inputs[0].props.onChangeText(value);
  });
  await settle();
}

export function isSelected(r: Renderer, chipText: string): boolean {
  const node = visibleTextNodes(r).filter(n => textOf(n) === chipText)[0];
  const chip = node && pressable(node);
  return !!chip?.props.accessibilityState?.selected;
}
