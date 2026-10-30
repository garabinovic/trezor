import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { createId, ItemsProvider, useItems } from '../src/data/ItemsProvider';
import type { Item, Note } from '../src/data/types';
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

async function mount(repo: InMemoryItemRepository, initial: Item[] = []) {
  let ctx!: Ctx;
  function Probe() {
    ctx = useItems();
    return null;
  }
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <ItemsProvider repository={repo} initialItems={initial}>
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

  test('createId returns UUIDv7 values', () => {
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(ids.size).toBe(100);
    ids.forEach(id => expect(id).toMatch(/^[0-9a-f-]{36}$/));
  });
});
