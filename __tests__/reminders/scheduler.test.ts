import type { Item, Reminder } from '../../src/data/types';
import type {
  ReminderPlatform,
  ScheduleEntry,
} from '../../src/reminders/platform';
import {
  intervalLabel,
  isOverdue,
  nextDue,
  nextFire,
  repeatLabel,
  withStart,
} from '../../src/reminders/reminderSchedule';
import { shouldAskForPermission } from '../../src/reminders/RemindersProvider';
import {
  buildEntries,
  createReconcileQueue,
  PENDING_GRACE_MS,
  reconcile,
} from '../../src/reminders/scheduler';

const NOW = Date.parse('2026-11-02T10:00:00.000Z');
const H = 3_600_000;

function reminder(patch: Partial<Reminder> & { id: string }): Reminder {
  const base: Reminder = {
    id: patch.id,
    type: 'reminder',
    title: `Title ${patch.id}`,
    dueAt: new Date(NOW + H).toISOString(),
    localStart: '2026-11-02T11:00',
    repeat: 'once',
    intervalMinutes: null,
    notes: `Notes ${patch.id}`,
    completed: false,
    pinned: false,
    createdAt: new Date(NOW - 24 * H).toISOString(),
    updatedAt: new Date(NOW - 24 * H).toISOString(),
  };
  return { ...base, ...patch };
}

/** In-memory platform that records syncs and keeps one entry per id. */
function fakePlatform(fired: string[] = []) {
  const state = {
    syncs: [] as { entries: ScheduleEntry[]; showDetails: boolean }[],
    fired: [...fired],
    enabled: true,
  };
  const platform: ReminderPlatform = {
    async sync(entries, showDetails) {
      state.syncs.push({ entries, showDetails });
      const once = new Set(
        entries.filter(e => e.mode === 'once').map(e => e.id),
      );
      state.fired = state.fired.filter(id => once.has(id));
    },
    async getFiredOnceIds() {
      return [...state.fired];
    },
    consumePendingTap: () => null,
    onTap: () => () => undefined,
    notificationsEnabled: async () => state.enabled,
  };
  return { platform, state, last: () => state.syncs[state.syncs.length - 1] };
}

/** A tiny "database" for reconcile. */
function store(items: Item[]) {
  let data = items.map(i => ({ ...i }));
  return {
    readStored: async () => data.map(i => ({ ...i })),
    completeFired: async (ids: string[]) => {
      data = data.map(i =>
        i.type === 'reminder' && ids.includes(i.id)
          ? { ...i, completed: true }
          : i,
      );
    },
    get: (id: string) => data.find(i => i.id === id) as Reminder | undefined,
    remove: (id: string) => {
      data = data.filter(i => i.id !== id);
    },
    set: (item: Item) => {
      data = [...data.filter(i => i.id !== item.id), item];
    },
  };
}

describe('next due / next fire', () => {
  test('ONCE: due is its time; fires only if in the future and not completed', () => {
    const future = reminder({ id: 'a' });
    expect(nextDue(future, NOW)).toBe(NOW + H);
    expect(nextFire(future, NOW)).toBe(NOW + H);
    const past = reminder({ id: 'b', dueAt: new Date(NOW - H).toISOString() });
    expect(nextFire(past, NOW)).toBeNull();
    expect(isOverdue(past, NOW)).toBe(true);
    expect(nextFire({ ...future, completed: true }, NOW)).toBeNull();
  });

  test('repeating reminders are never overdue and always have a next time', () => {
    const daily = reminder({
      id: 'd',
      repeat: 'daily',
      dueAt: new Date(NOW - 10 * 24 * H).toISOString(),
      localStart: '2026-10-23T08:30',
    });
    expect(isOverdue(daily, NOW)).toBe(false);
    expect(nextFire(daily, NOW)! > NOW).toBe(true);
    expect(nextDue(daily, NOW)).toBe(nextFire(daily, NOW));
  });

  test('completed then reactivated: repeating resumes, past ONCE does not', () => {
    const weekly = reminder({ id: 'w', repeat: 'weekly', completed: true });
    expect(nextFire(weekly, NOW)).toBeNull();
    expect(nextFire({ ...weekly, completed: false }, NOW)).not.toBeNull();
    const oldOnce = reminder({
      id: 'o',
      dueAt: new Date(NOW - H).toISOString(),
      completed: true,
    });
    expect(nextFire({ ...oldOnce, completed: false }, NOW)).toBeNull();
  });

  test('labels', () => {
    expect(repeatLabel(reminder({ id: 'x', repeat: 'monthly' }))).toBe(
      'Every month',
    );
    expect(
      repeatLabel(
        reminder({ id: 'x', repeat: 'interval', intervalMinutes: 60 }),
      ),
    ).toBe('Every hour');
    expect(intervalLabel(240)).toBe('Every 4 hours');
  });

  test('withStart sets the instant and the matching local start', () => {
    const r = withStart(
      reminder({ id: 'x' }),
      Date.parse('2026-12-24T18:45:00Z'),
    );
    expect(r.dueAt).toBe('2026-12-24T18:45:00.000Z');
    const d = new Date('2026-12-24T18:45:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(r.localStart).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours(),
      )}:${pad(d.getMinutes())}`,
    );
  });
});

describe('buildEntries', () => {
  const items: Item[] = [
    reminder({ id: 'once' }),
    reminder({ id: 'past', dueAt: new Date(NOW - 2 * H).toISOString() }),
    reminder({ id: 'done', repeat: 'daily', completed: true }),
    reminder({ id: 'daily', repeat: 'daily' }),
    reminder({ id: 'int', repeat: 'interval', intervalMinutes: 120 }),
    {
      id: 'note',
      type: 'note',
      title: 'n',
      body: '',
      pinned: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  test('arms only active reminders with a future occurrence; ids are the reminder ids', () => {
    const entries = buildEntries(items, false, NOW);
    expect(entries.map(e => e.id)).toEqual(['once', 'daily', 'int']);
    expect(entries.find(e => e.id === 'int')).toMatchObject({
      mode: 'interval',
      intervalMinutes: 120,
    });
    expect(entries.find(e => e.id === 'daily')?.intervalMinutes).toBeNull();
  });

  test('a ONCE reminder that is due but may not be delivered yet is still handed over', () => {
    const due = (ms: number) =>
      reminder({ id: 'p', dueAt: new Date(NOW - ms).toISOString() });
    expect(buildEntries([due(H)], false, NOW).map(e => e.id)).toEqual(['p']);
    expect(buildEntries([due(PENDING_GRACE_MS - 1)], false, NOW)).toHaveLength(
      1,
    );
    expect(buildEntries([due(PENDING_GRACE_MS)], false, NOW)).toHaveLength(0);
  });

  test('hidden details: no title or description leaves the database', () => {
    for (const e of buildEntries(items, false, NOW)) {
      expect(e.title).toBeNull();
      expect(e.body).toBeNull();
    }
  });

  test('shown details: title and description, empty description omitted', () => {
    const withEmpty = [...items, reminder({ id: 'empty', notes: '' })];
    const entries = buildEntries(withEmpty, true, NOW);
    expect(entries.find(e => e.id === 'once')).toMatchObject({
      title: 'Title once',
      body: 'Notes once',
    });
    expect(entries.find(e => e.id === 'empty')?.body).toBeNull();
  });
});

describe('reconcile', () => {
  test('is idempotent: repeated runs produce the same schedule', async () => {
    const db = store([
      reminder({ id: 'a' }),
      reminder({ id: 'b', repeat: 'daily' }),
    ]);
    const { platform, state } = fakePlatform();
    for (let i = 0; i < 3; i++) {
      await reconcile(platform, { ...db, showDetails: false }, NOW);
    }
    const ids = state.syncs.map(s =>
      s.entries
        .map(e => e.id)
        .sort()
        .join(),
    );
    expect(ids).toEqual(['a,b', 'a,b', 'a,b']);
  });

  test('edits, deletions and completion replace the schedule (stale entries removed)', async () => {
    const db = store([
      reminder({ id: 'a' }),
      reminder({ id: 'b', repeat: 'daily' }),
    ]);
    const { platform, last } = fakePlatform();
    await reconcile(platform, { ...db, showDetails: false }, NOW);

    db.set({ ...db.get('a')!, repeat: 'weekly' }); // edit recurrence
    db.remove('b'); // delete
    await reconcile(platform, { ...db, showDetails: false }, NOW);
    expect(last().entries.map(e => [e.id, e.mode])).toEqual([['a', 'weekly']]);

    db.set({ ...db.get('a')!, completed: true }); // complete
    await reconcile(platform, { ...db, showDetails: false }, NOW);
    expect(last().entries).toEqual([]);

    db.set({ ...db.get('a')!, completed: false }); // reactivate (still valid)
    await reconcile(platform, { ...db, showDetails: false }, NOW);
    expect(last().entries.map(e => e.id)).toEqual(['a']);
  });

  test('fired ONCE reminders are completed and dropped from the schedule', async () => {
    const db = store([reminder({ id: 'a' }), reminder({ id: 'b' })]);
    const { platform, state, last } = fakePlatform(['a']);
    const result = await reconcile(
      platform,
      { ...db, showDetails: false },
      NOW,
    );
    expect(result.completed).toEqual(['a']);
    expect(db.get('a')?.completed).toBe(true);
    expect(last().entries.map(e => e.id)).toEqual(['b']);
    expect(state.fired).toEqual([]);
  });

  test('a fired id for a deleted or repeating reminder is not recreated or completed', async () => {
    const db = store([reminder({ id: 'r', repeat: 'daily' })]);
    const { platform, last } = fakePlatform(['deleted', 'r']);
    const result = await reconcile(
      platform,
      { ...db, showDetails: false },
      NOW,
    );
    expect(result.completed).toEqual([]);
    expect(db.get('deleted')).toBeUndefined();
    expect(db.get('r')?.completed).toBe(false);
    expect(last().entries.map(e => e.id)).toEqual(['r']);
  });

  test('changing privacy keeps every scheduled time and recurrence', async () => {
    const db = store([
      reminder({ id: 'a', repeat: 'monthly' }),
      reminder({ id: 'b', repeat: 'interval', intervalMinutes: 60 }),
    ]);
    const { platform, state } = fakePlatform();
    await reconcile(platform, { ...db, showDetails: true }, NOW);
    await reconcile(platform, { ...db, showDetails: false }, NOW);
    const [shown, hidden] = state.syncs;
    expect(shown.showDetails).toBe(true);
    expect(hidden.showDetails).toBe(false);
    const strip = (e: ScheduleEntry) => ({ ...e, title: null, body: null });
    expect(hidden.entries).toEqual(shown.entries.map(strip));
    expect(shown.entries[0].title).toBe('Title a');
  });

  test('permission denied does not block scheduling or lose data', async () => {
    const db = store([reminder({ id: 'a' })]);
    const { platform, state, last } = fakePlatform();
    state.enabled = false;
    await reconcile(platform, { ...db, showDetails: false }, NOW);
    expect(last().entries.map(e => e.id)).toEqual(['a']);
    expect(db.get('a')).toBeDefined();
  });

  test('platform failures propagate to the caller', async () => {
    const db = store([reminder({ id: 'a' })]);
    const { platform } = fakePlatform();
    platform.sync = async () => {
      throw Object.assign(new Error('x'), { code: 'SCHEDULE_FAILED' });
    };
    await expect(
      reconcile(platform, { ...db, showDetails: false }, NOW),
    ).rejects.toMatchObject({ code: 'SCHEDULE_FAILED' });
  });
});

describe('reconcile queue', () => {
  test('runs one at a time and coalesces requests made during a run', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const request = createReconcileQueue(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      runs++;
      await new Promise<void>(r => setTimeout(r, 5));
      active--;
    });
    await Promise.all([request(), request(), request(), request()]);
    expect(maxActive).toBe(1);
    expect(runs).toBe(2); // the first run, plus one coalesced re-run
  });

  test('a failing run does not stop later ones', async () => {
    let calls = 0;
    const request = createReconcileQueue(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('first fails');
      }
    });
    await request();
    await request();
    expect(calls).toBe(2);
  });
});

describe('permission prompt', () => {
  const base = { os: 'android', sdk: 34, alreadyAsked: false, enabled: false };
  test('asks once, only on Android 13+, only when notifications are off', () => {
    expect(shouldAskForPermission(base)).toBe(true);
    expect(shouldAskForPermission({ ...base, alreadyAsked: true })).toBe(false);
    expect(shouldAskForPermission({ ...base, sdk: 32 })).toBe(false);
    expect(shouldAskForPermission({ ...base, enabled: true })).toBe(false);
    expect(shouldAskForPermission({ ...base, os: 'ios' })).toBe(false);
  });
});
