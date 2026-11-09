// The reminder-reconcile part of the restore gate (Phase 6 spec v2.4 §8.7).
// A reconcile reads the database and then replaces the native schedule; one
// that is between those two steps while a restore clears the schedule
// (§8.2 step 10–11) would arm the old alarms again. So a restore holds this
// gate before it takes the database gate: holding waits for a reconcile
// already running, and reconciles requested meanwhile wait until release.
// (Taking it after the database gate could deadlock: a running reconcile may
// be waiting for a database read queued behind that gate.)

let holds = 0;
let running = 0;
let opened: (() => void)[] = [];
let idle: (() => void)[] = [];
const releasedListeners = new Set<() => void>();

function settle(list: (() => void)[]) {
  for (const resolve of list.splice(0)) {
    resolve();
  }
}

/** Runs one reconcile, waiting first while a restore holds the gate. */
export async function runReconcile<T>(run: () => Promise<T>): Promise<T> {
  while (holds > 0) {
    await new Promise<void>(resolve => opened.push(resolve));
  }
  running += 1;
  try {
    return await run();
  } finally {
    running -= 1;
    if (running === 0) {
      settle(idle);
    }
  }
}

/**
 * Takes the gate once no reconcile is running; returns its release. Releasing
 * lets waiting reconciles run and notifies listeners (who request a normal
 * reconcile, §8.2 pre-swap failure step 4). Release is idempotent.
 */
export async function holdReconcile(): Promise<() => void> {
  holds += 1;
  while (running > 0) {
    await new Promise<void>(resolve => idle.push(resolve));
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    holds -= 1;
    if (holds === 0) {
      settle(opened);
      releasedListeners.forEach(listener => listener());
    }
  };
}

/** Called after every final release (the reminders provider requests a reconcile). */
export function onReconcileReleased(listener: () => void): () => void {
  releasedListeners.add(listener);
  return () => releasedListeners.delete(listener);
}

/** Tests only. */
export function resetReconcileGateForTests() {
  holds = 0;
  running = 0;
  opened = [];
  idle = [];
  releasedListeners.clear();
}
