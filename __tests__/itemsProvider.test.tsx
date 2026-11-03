import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { createId, ItemsProvider, useItems } from '../src/data/ItemsProvider';
import type { Attachment, DocumentItem, Item, Note } from '../src/data/types';
import { InMemoryItemRepository } from '../src/storage/ItemRepository';

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

async function mount(
  repo: InMemoryItemRepository,
  initial: Item[] = [],
  deleteAttachmentFiles?: (ids: string[]) => Promise<void>,
) {
  let ctx!: Ctx;
  function Probe() {
    ctx = useItems();
    return null;
  }
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
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
    act: async (fn: (c: Ctx) => void) => {
      await ReactTestRenderer.act(async () => {
        fn(ctx);
        // Let the write queue drain.
        await new Promise<void>(r => setTimeout(r, 0));
      });
    },
  };
}

describe('ItemsProvider', () => {
  test('writes create, pin, complete and delete through to the repository', async () => {
    const repo = new InMemoryItemRepository();
    const p = await mount(repo);

    await p.act(c => c.saveItem(note('a')));
    expect((await repo.listAll()).map(i => i.id)).toEqual(['a']);

    await p.act(c => c.togglePinned('a'));
    expect((await repo.listAll())[0].pinned).toBe(true);
    expect(p.get().items[0].pinned).toBe(true);

    await p.act(c => c.deleteItem('a'));
    expect(await repo.listAll()).toEqual([]);
    expect(p.get().items).toEqual([]);
  });

  test('a failed write reloads stored state and raises writeError', async () => {
    const repo = new InMemoryItemRepository([note('a', 'Stored')]);
    const p = await mount(repo, await repo.listAll());
    jest.spyOn(repo, 'save').mockRejectedValueOnce(new Error('disk full'));

    await p.act(c => c.saveItem({ ...note('a'), title: 'Not saved' }));

    expect(p.get().writeError).toBe(true);
    expect(p.get().items.map(i => i.title)).toEqual(['Stored']);
    await p.act(c => c.dismissWriteError());
    expect(p.get().writeError).toBe(false);
  });

  test('sample data never reaches the real repository', async () => {
    const repo = new InMemoryItemRepository([note('real')]);
    const p = await mount(repo, await repo.listAll());

    await p.act(c => c.setSampleDataEnabled(true));
    expect(p.get().items.length).toBeGreaterThan(1);
    await p.act(c => c.saveItem(note('created-in-sample-mode')));
    await p.act(c => c.deleteItem('real'));

    await p.act(c => c.setSampleDataEnabled(false));
    expect(p.get().items.map(i => i.id)).toEqual(['real']);
    expect((await repo.listAll()).map(i => i.id)).toEqual(['real']);
  });

  describe('attachment files', () => {
    test('are deleted after the write that removed them commits', async () => {
      const repo = new InMemoryItemRepository([
        doc('d', [file(1), file(2), file(3)]),
        doc('e', [file(4)]),
      ]);
      const deleted: string[][] = [];
      const p = await mount(repo, await repo.listAll(), async ids => {
        // Deleting files happens only once the rows are gone.
        expect(await repo.listAttachmentIds()).not.toContain(ids[0]);
        deleted.push(ids);
      });

      await p.act(c => c.saveItem(doc('d', [file(2)])));
      await p.act(c => c.togglePinned('d'));
      await p.act(c => c.deleteItem('e'));

      expect(deleted).toEqual([[file(1).id, file(3).id], [file(4).id]]);
      expect(await repo.listAttachmentIds()).toEqual([file(2).id]);
    });

    test('are kept when the write fails', async () => {
      const repo = new InMemoryItemRepository([doc('d', [file(1)])]);
      const remove = jest.fn(async (_ids: string[]) => {});
      const p = await mount(repo, await repo.listAll(), remove);
      jest.spyOn(repo, 'delete').mockRejectedValueOnce(new Error('disk full'));

      await p.act(c => c.deleteItem('d'));

      expect(p.get().writeError).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      expect(await repo.listAttachmentIds()).toEqual([file(1).id]);
    });

    test('a failed file deletion is not a write error', async () => {
      const repo = new InMemoryItemRepository([doc('d', [file(1)])]);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const p = await mount(repo, await repo.listAll(), async () => {
        throw new Error('io');
      });

      await p.act(c => c.deleteItem('d'));

      expect(p.get().writeError).toBe(false);
      expect(p.get().items).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        '[attachments] could not delete removed files',
      );
      warn.mockRestore();
    });

    test('are never deleted for sample data', async () => {
      const repo = new InMemoryItemRepository([note('real')]);
      const remove = jest.fn(async (_ids: string[]) => {});
      const p = await mount(repo, await repo.listAll(), remove);

      await p.act(c => c.setSampleDataEnabled(true));
      const sampleWithFiles = p
        .get()
        .items.filter(
          (i): i is DocumentItem =>
            i.type === 'document' && i.attachments.length > 0,
        );
      expect(sampleWithFiles.length).toBeGreaterThan(0);
      for (const d of sampleWithFiles) {
        await p.act(c => c.deleteItem(d.id));
      }

      expect(remove).not.toHaveBeenCalled();
    });
  });

  test('createId returns UUIDv7 values', () => {
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(ids.size).toBe(100);
    ids.forEach(id => expect(id).toMatch(/^[0-9a-f-]{36}$/));
  });
});
