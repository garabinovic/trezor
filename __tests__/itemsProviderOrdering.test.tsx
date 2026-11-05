import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ItemsProvider, useItems } from '../src/data/ItemsProvider';
import type {
  Attachment,
  DocumentItem,
  Item,
  Note,
  Reminder,
} from '../src/data/types';
import { InMemoryItemRepository } from '../src/storage/ItemRepository';

// Write N failing while later writes are queued (audit V3), reminder
// completion racing a local change (V4), and two React roots on one
// repository. Every operation the tests care about is held by a gate, so the
// interleavings are exact.

type Ctx = ReturnType<typeof useItems>;

const note = (id: string, title = id): Note => ({
  id,
  type: 'note',
  title,
  body: '',
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const file = (n: number): Attachment => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef479${String(n).padStart(2, '0')}`,
  fileName: `scan-${n}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
  formatVersion: 1,
  createdAt: '2026-11-03T00:00:00.000Z',
});

const doc = (id: string, attachments: Attachment[]): DocumentItem => ({
  id,
  type: 'document',
  title: id,
  kind: 'receipt',
  merchant: '',
  date: null,
  expiresOn: null,
  amount: null,
  currency: '',
  notes: '',
  attachments,
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const reminder = (id: string): Reminder => ({
  id,
  type: 'reminder',
  title: id,
  dueAt: '2026-11-05T08:00:00.000Z',
  localStart: '2026-11-05T09:00',
  intervalMinutes: null,
  repeat: 'once',
  notes: '',
  completed: false,
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

interface Gate {
  /** Lets the held operation run. */
  release: () => void;
  /** Makes the held operation fail instead. */
  fail: (error: Error) => void;
}

/** An in-memory repository whose operations can be held, and which logs them. */
class GatedRepository extends InMemoryItemRepository {
  /** Operations in the order they reach storage (held ones included). */
  log: string[] = [];
  private gates = new Map<string, Promise<void>>();

  /** Holds the next `op` ("save:a", "listAll", …) until released or failed. */
  hold(op: string): Gate {
    let gate!: Gate;
    this.gates.set(
      op,
      new Promise<void>((resolve, reject) => {
        gate = { release: resolve, fail: reject };
      }),
    );
    return gate;
  }

  private async pass(op: string) {
    this.log.push(op);
    const gate = this.gates.get(op);
    if (gate) {
      this.gates.delete(op);
      await gate;
    }
  }

  async listAll() {
    await this.pass('listAll');
    return super.listAll();
  }

  async save(item: Item) {
    await this.pass(`save:${item.id}`);
    return super.save(item);
  }

  async delete(id: string) {
    await this.pass(`delete:${id}`);
    return super.delete(id);
  }
}

/** Lets every queued step that isn't held run to completion. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

async function mount(
  repo: InMemoryItemRepository,
  initial: Item[],
  deleteAttachmentFiles?: (ids: string[]) => Promise<void>,
) {
  let ctx!: Ctx;
  function Probe() {
    ctx = useItems();
    return null;
  }
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(
      <ItemsProvider
        repository={repo}
        initialItems={initial}
        deleteAttachmentFiles={deleteAttachmentFiles}
      >
        <Probe />
      </ItemsProvider>,
    );
  });
  return {
    get: () => ctx,
    titles: () => ctx.items.map(i => `${i.id}:${i.title}`).sort(),
    run: (fn: (c: Ctx) => void) =>
      ReactTestRenderer.act(async () => {
        fn(ctx);
      }),
    unmount: () => ReactTestRenderer.act(async () => root.unmount()),
  };
}

describe('a failed write reloads only after the writes queued behind it (V3)', () => {
  test('a deleted document stays deleted, and its files go', async () => {
    const repo = new GatedRepository([
      note('a', 'Stored'),
      doc('d', [file(1), file(2)]),
    ]);
    const deletedFiles: string[][] = [];
    const p = await mount(repo, await repo.listAll(), async ids => {
      deletedFiles.push(ids);
    });
    repo.log = [];
    const n = repo.hold('save:a');

    await p.run(c => c.saveItem(note('a', 'Not saved'))); // write N
    await p.run(c => c.deleteItem('d')); // write N+1, queued behind N
    n.fail(new Error('disk full'));
    await settle();

    // The reload came after N+1, so it can't show D again.
    expect(repo.log).toEqual(['save:a', 'delete:d', 'listAll']);
    expect(p.get().writeError).toBe(true);
    expect(p.titles()).toEqual(['a:Stored']);
    expect(deletedFiles).toEqual([[file(1).id, file(2).id]]);

    // Pinning D now does nothing; it can't be saved back without its files.
    await p.run(c => c.togglePinned('d'));
    await settle();
    expect((await repo.listAll()).map(i => i.id)).toEqual(['a']);
    expect(await repo.listAttachmentIds()).toEqual([]);
  });

  test('a later edit saves on top of the newer write, not a stale copy', async () => {
    const repo = new GatedRepository([note('a'), note('b', 'Old title')]);
    const p = await mount(repo, await repo.listAll());
    const n = repo.hold('save:a');

    await p.run(c => c.saveItem(note('a', 'Not saved'))); // N fails
    await p.run(c => c.saveItem(note('b', 'New title'))); // N+1 commits
    n.fail(new Error('disk full'));
    await settle();
    expect(p.titles()).toEqual(['a:a', 'b:New title']);

    // Editing another field of b keeps N+1's title.
    await p.run(c => c.togglePinned('b'));
    await settle();
    const b = (await repo.listAll()).find(i => i.id === 'b')!;
    expect(b.title).toBe('New title');
    expect(b.pinned).toBe(true);
  });

  test('several writes behind a failure lead to one reload, after the last', async () => {
    const repo = new GatedRepository([note('a'), note('b'), note('c')]);
    const p = await mount(repo, await repo.listAll());
    repo.log = [];
    const n = repo.hold('save:a');

    await p.run(c => c.saveItem(note('a', 'x')));
    await p.run(c => c.saveItem(note('b', 'B2')));
    await p.run(c => c.deleteItem('c'));
    n.fail(new Error('disk full'));
    await settle();

    expect(repo.log).toEqual(['save:a', 'save:b', 'delete:c', 'listAll']);
    expect(p.titles()).toEqual(['a:a', 'b:B2']);
  });

  test('a local change made while the reload reads is not overwritten by it', async () => {
    const repo = new GatedRepository([note('a'), note('b')]);
    const p = await mount(repo, await repo.listAll());
    const n = repo.hold('save:a');
    const reload = repo.hold('listAll');
    await p.run(c => c.saveItem(note('a', 'x')));
    n.fail(new Error('disk full'));
    await settle(); // N failed; its reload is now held

    // A local change made while the reload reads: the read can't include it.
    const later = repo.hold('save:b');
    await p.run(c => c.saveItem(note('b', 'Newer')));
    reload.release();
    await settle();
    // The older read is dropped; "Newer" stays.
    expect(p.titles()).toContain('b:Newer');

    later.release();
    await settle();
    expect(p.titles()).toEqual(['a:a', 'b:Newer']);
    expect((await repo.listAll()).find(i => i.id === 'b')!.title).toBe('Newer');
  });

  test('a reload that fails keeps the last state shown, and the next write retries it', async () => {
    const repo = new GatedRepository([note('a', 'Stored')]);
    const p = await mount(repo, await repo.listAll());
    const n = repo.hold('save:a');
    await p.run(c => c.saveItem(note('a', 'Not saved')));
    const reload = repo.hold('listAll');
    n.fail(new Error('disk full'));
    await settle();
    reload.fail(new Error('database is locked'));
    await settle();

    expect(p.get().writeError).toBe(true);
    // Not emptied: the last state shown stays.
    expect(p.titles()).toEqual(['a:Not saved']);

    await p.run(c => c.saveItem(note('b')));
    await settle();
    expect(p.titles()).toEqual(['a:Stored', 'b:b']);
  });

  test('no reload when every write succeeds', async () => {
    const repo = new GatedRepository([note('a')]);
    const p = await mount(repo, await repo.listAll());
    repo.log = [];
    await p.run(c => c.saveItem(note('a', 'A2')));
    await p.run(c => c.deleteItem('a'));
    await settle();
    expect(repo.log).toEqual(['save:a', 'delete:a']);
  });
});

describe('reminder completion is applied inside the queue (V4)', () => {
  test('a change made while completing is not overwritten by the completion read', async () => {
    const repo = new GatedRepository([reminder('r'), note('n', 'Old')]);
    const p = await mount(repo, await repo.listAll());
    // The completion's write runs first; hold it so a local change comes in.
    const completing = repo.hold('save:r');
    let completed!: Promise<void>;
    await p.run(c => {
      completed = c.completeStoredReminders(['r']);
    });
    const newer = repo.hold('save:n');
    await p.run(c => c.saveItem(note('n', 'Newer')));
    completing.release();
    await ReactTestRenderer.act(() => completed);

    // The completion's read didn't include "Newer" (its write is behind it),
    // so it isn't applied over it.
    expect(p.titles()).toContain('n:Newer');

    newer.release();
    await settle();
    expect(p.titles()).toEqual(['n:Newer', 'r:r']);
    const r = p.get().items.find(i => i.id === 'r') as Reminder;
    expect(r.completed).toBe(true);
    expect(await repo.listAll()).toEqual(p.get().items);
  });

  test('without a concurrent change, the completion shows at once', async () => {
    const repo = new GatedRepository([reminder('r')]);
    const p = await mount(repo, await repo.listAll());
    await ReactTestRenderer.act(() => p.get().completeStoredReminders(['r']));
    expect((p.get().items[0] as Reminder).completed).toBe(true);
  });
});

describe('two React roots on one repository', () => {
  test("a second root waits for the first root's queued writes and orders after them", async () => {
    const repo = new GatedRepository([note('a')]);
    const first = await mount(repo, await repo.listAll());
    repo.log = [];
    const held = repo.hold('save:x');
    await first.run(c => c.saveItem(note('x', 'From the first root')));

    // The Activity is recreated: the new root loaded its items before x landed.
    await first.unmount();
    const second = await mount(repo, await repo.listAll());
    expect(second.titles()).toEqual(['a:a']);
    await second.run(c => c.saveItem(note('y', 'From the second root')));
    await settle();
    // y waits behind x in the one queue: it hasn't reached storage.
    expect(repo.log.filter(op => op.startsWith('save'))).toEqual(['save:x']);

    held.release();
    await settle();

    // One queue: x before y, and the new root shows both.
    expect(repo.log.filter(op => op.startsWith('save'))).toEqual([
      'save:x',
      'save:y',
    ]);
    expect(second.titles()).toEqual([
      'a:a',
      'x:From the first root',
      'y:From the second root',
    ]);
  });

  test('a second root mounted with nothing queued does not reload', async () => {
    const repo = new GatedRepository([note('a')]);
    await mount(repo, await repo.listAll());
    repo.log = [];
    await mount(repo, await repo.listAll());
    await settle();
    expect(repo.log).toEqual(['listAll']); // only the test's own read
  });
});
