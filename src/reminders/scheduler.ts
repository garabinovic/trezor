// Reconciliation between the encrypted database (source of truth) and the
// Android notification schedule (an operational copy). Safe to run any number
// of times: every run rebuilds the whole native schedule, so it cannot create
// duplicates or leave stale alarms behind.
import type { Item, Reminder } from '../data/types';
import type { ReminderPlatform, ScheduleEntry } from './platform';
import { nextFire } from './reminderSchedule';

/**
 * How long after its time a ONCE reminder is still handed to the native
 * scheduler. Android may deliver an alarm up to an hour late, so a reminder
 * that is due but not yet delivered must not be dropped; the native side keeps
 * it armed only if it is still pending, and never re-delivers it.
 */
export const PENDING_GRACE_MS = 75 * 60_000;

/**
 * Entries to arm: reminders that are not completed and still have an
 * occurrence after now (or, for ONCE, within the delivery grace period). An
 * older ONCE reminder is never armed (it shows as overdue in the app instead).
 * Text is included only when details may be shown.
 */
export function buildEntries(
  items: Item[],
  showDetails: boolean,
  now: number = Date.now(),
): ScheduleEntry[] {
  return items
    .filter((i): i is Reminder => i.type === 'reminder')
    .filter(r => nextFire(r, now - PENDING_GRACE_MS) !== null)
    .map(r => ({
      id: r.id,
      mode: r.repeat,
      startAt: Date.parse(r.dueAt),
      localStart: r.localStart,
      intervalMinutes: r.repeat === 'interval' ? r.intervalMinutes : null,
      title: showDetails ? r.title : null,
      body: showDetails && r.notes ? r.notes : null,
    }));
}

export interface ReconcileSources {
  /** Reads reminders from the encrypted database, after pending writes. */
  readStored(): Promise<Item[]>;
  /** Marks ONCE reminders that fired as completed, in the database. */
  completeFired(ids: string[]): Promise<void>;
  showDetails: boolean;
}

export interface ReconcileResult {
  scheduled: number;
  completed: string[];
}

/**
 * 1. ONCE reminders the system fired are marked completed in the database
 *    (only those that still exist, are ONCE and not yet completed; a deleted
 *    reminder is never recreated).
 * 2. The native schedule is replaced with what the database says now.
 */
export async function reconcile(
  platform: ReminderPlatform,
  sources: ReconcileSources,
  now: number = Date.now(),
): Promise<ReconcileResult> {
  const fired = new Set(await platform.getFiredOnceIds());
  let stored = await sources.readStored();

  const toComplete = stored
    .filter(
      (i): i is Reminder =>
        i.type === 'reminder' &&
        fired.has(i.id) &&
        i.repeat === 'once' &&
        !i.completed,
    )
    .map(r => r.id);
  if (toComplete.length > 0) {
    await sources.completeFired(toComplete);
    stored = await sources.readStored();
  }

  const entries = buildEntries(stored, sources.showDetails, now);
  await platform.sync(entries, sources.showDetails);
  return { scheduled: entries.length, completed: toComplete };
}

/** Runs reconciliations one at a time; a request during a run is coalesced. */
export function createReconcileQueue(run: () => Promise<unknown>) {
  let running: Promise<void> | null = null;
  let again = false;

  const loop = async () => {
    do {
      again = false;
      try {
        await run();
      } catch {
        // Reported by `run`; the next trigger retries.
      }
    } while (again);
    running = null;
  };

  return function request(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}
