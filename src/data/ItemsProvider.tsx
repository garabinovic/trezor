import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { uuidv7 } from '../storage/ids';
import {
  InMemoryItemRepository,
  ItemRepository,
} from '../storage/ItemRepository';
import { vault } from '../storage/vault';
import { Item, ItemOfType, ItemType } from './types';

/**
 * The UI's single source of items. Updates are applied to state immediately
 * and written to the repository in order; if a write fails, `writeError` is
 * set so the UI can tell the user, and state is reloaded from storage once
 * every write queued until then has settled (an earlier reload would miss
 * them, and a later save could write that stale copy back).
 */
interface ItemsContextValue {
  items: Item[];
  /** Development builds only: show in-memory sample data instead of saved items. */
  sampleDataEnabled: boolean;
  setSampleDataEnabled: (enabled: boolean) => void;
  /**
   * Saves an item. Resolves with true once it is stored, or false if the
   * write failed (`writeError` is raised and state reloaded, as for any failed
   * write). Never rejects.
   */
  saveItem: (item: Item) => Promise<boolean>;
  deleteItem: (id: string) => void;
  togglePinned: (id: string) => void;
  setReminderCompleted: (id: string, completed: boolean) => void;
  writeError: boolean;
  dismissWriteError: () => void;
  /** Searches the active repository (the encrypted database in normal use). */
  searchItems: (term: string) => Promise<Item[]>;
  /**
   * Reads the user's stored items from the database after pending writes.
   * Always the real repository, never development sample data.
   */
  readStored: () => Promise<Item[]>;
  /** Marks stored reminders completed (fired ONCE reminders). */
  completeStoredReminders: (ids: string[]) => Promise<void>;
}

const ItemsContext = createContext<ItemsContextValue | null>(null);

/**
 * The item write queue of one repository. A second React root (a recreated
 * Activity while the JS runtime lives on) gets the same repository from
 * openStorage, so it shares this queue: its writes and reads stay ordered
 * after those the first root still has queued.
 */
interface WriteQueue {
  tail: Promise<void>;
  /** Item writes queued and not settled yet, from any provider. */
  pending: number;
  /** Item writes ever queued, from any provider. */
  started: number;
}

const queues = new WeakMap<ItemRepository, WriteQueue>();

function queueFor(repository: ItemRepository): WriteQueue {
  let queue = queues.get(repository);
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0, started: 0 };
    queues.set(repository, queue);
  }
  return queue;
}

interface ItemsProviderProps {
  /** Persistent storage for the user's items. */
  repository: ItemRepository;
  /** Items already loaded from `repository`, so the first render is complete. */
  initialItems: Item[];
  /**
   * Deletes encrypted files of attachments that a committed write removed
   * from `repository`. A failure leaves orphans for the startup cleanup.
   */
  deleteAttachmentFiles?: (ids: string[]) => Promise<void>;
  children: ReactNode;
}

export function ItemsProvider({
  repository,
  initialItems,
  deleteAttachmentFiles,
  children,
}: ItemsProviderProps) {
  const [items, setItemsState] = useState<Item[]>(initialItems);
  const [sampleDataEnabled, setSampleDataEnabledState] = useState(false);
  const [writeError, setWriteError] = useState(false);

  // Refs give callbacks the latest values without re-creating them.
  const itemsRef = useRef(items);
  const activeRepo = useRef<ItemRepository>(repository);
  const queue = useMemo(() => queueFor(repository), [repository]);
  /** Bumped by every local change: a read older than that must not replace it. */
  const generation = useRef(0);
  /** State may differ from storage; reload once no item write is pending. */
  const stale = useRef(false);

  const setItems = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  /**
   * Runs as a step of the queue, never awaits it. Reloads only when nothing
   * else is pending (a later write's step reloads instead) and applies the
   * result only if no local change was made meanwhile; that change's own
   * step reloads again. A failed reload keeps the current state.
   */
  const reloadIfDrained = useCallback(
    async (repo: ItemRepository) => {
      if (!stale.current || queue.pending > 0) {
        return;
      }
      const seen = generation.current;
      try {
        const stored = await repo.listAll();
        if (activeRepo.current === repo && generation.current === seen) {
          stale.current = false;
          setItems(stored);
        }
      } catch {
        // Keep current state; the error dialog is already showing.
      }
    },
    [queue, setItems],
  );

  // Another root has written through this queue, so this root's items (loaded
  // by openStorage outside the queue) may predate some of those writes, even
  // ones that settled before this mount: show what is stored once the queue
  // has drained.
  useEffect(() => {
    if (queue.started > 0) {
      stale.current = true;
      queue.tail = queue.tail.then(() => reloadIfDrained(repository));
    }
  }, [queue, repository, reloadIfDrained]);

  /**
   * Applies a change locally, then persists it after any earlier writes.
   * `write` resolves with the attachment ids it removed from storage. Resolves
   * with true once stored, false if the write failed; never rejects.
   */
  const commit = useCallback(
    (
      next: Item[],
      write: (repo: ItemRepository) => Promise<string[]>,
    ): Promise<boolean> => {
      const repo = activeRepo.current;
      let outcome!: (stored: boolean) => void;
      const settled = new Promise<boolean>(resolve => (outcome = resolve));
      setItems(next);
      generation.current += 1;
      queue.pending += 1;
      queue.started += 1;
      queue.tail = queue.tail
        .then(async () => {
          const removed = await write(repo);
          // Only the user's storage has files; sample data never does.
          if (
            removed.length > 0 &&
            repo === repository &&
            deleteAttachmentFiles
          ) {
            deleteAttachmentFiles(removed).catch(() =>
              console.warn('[attachments] could not delete removed files'),
            );
          }
          outcome(true);
        })
        .catch(() => {
          setWriteError(true);
          // Fall back to what is actually stored, after the writes behind it.
          stale.current = true;
          outcome(false);
        })
        .then(() => {
          queue.pending -= 1;
          return reloadIfDrained(repo);
        });
      return settled;
    },
    [setItems, repository, deleteAttachmentFiles, queue, reloadIfDrained],
  );

  const setSampleDataEnabled = useCallback(
    (enabled: boolean) => {
      // Inline __DEV__ (not the exported constant) so release bundles drop
      // this branch and the sample data module entirely.
      if (!__DEV__) {
        return;
      }
      const { createSampleItems } = require('./sampleData');
      setSampleDataEnabledState(enabled);
      // Sample data lives in a separate in-memory repository, so it can never
      // be written to, or mixed with, the user's saved items.
      const repo = enabled
        ? new InMemoryItemRepository(createSampleItems())
        : repository;
      activeRepo.current = repo;
      queue.tail = queue.tail
        .then(() => repo.listAll())
        .then(loaded => {
          if (activeRepo.current === repo) {
            setItems(loaded);
          }
        })
        .catch(() => setWriteError(true));
    },
    [repository, setItems, queue],
  );

  const saveItem = useCallback(
    (item: Item) => {
      const current = itemsRef.current;
      const exists = current.some(i => i.id === item.id);
      return commit(
        exists
          ? current.map(i => (i.id === item.id ? item : i))
          : [item, ...current],
        repo => repo.save(item),
      );
    },
    [commit],
  );

  const deleteItem = useCallback(
    (id: string) => {
      commit(
        itemsRef.current.filter(i => i.id !== id),
        repo => repo.delete(id),
      );
    },
    [commit],
  );

  const update = useCallback(
    (id: string, change: (item: Item) => Item) => {
      const target = itemsRef.current.find(i => i.id === id);
      if (!target) {
        return;
      }
      const updated = {
        ...change(target),
        updatedAt: new Date().toISOString(),
      } as Item;
      commit(
        itemsRef.current.map(i => (i.id === id ? updated : i)),
        repo => repo.save(updated),
      );
    },
    [commit],
  );

  const togglePinned = useCallback(
    (id: string) => update(id, i => ({ ...i, pinned: !i.pinned })),
    [update],
  );

  const setReminderCompleted = useCallback(
    (id: string, completed: boolean) =>
      update(id, i => (i.type === 'reminder' ? { ...i, completed } : i)),
    [update],
  );

  const dismissWriteError = useCallback(() => setWriteError(false), []);

  const searchItems = useCallback(
    (term: string) => activeRepo.current.search(term),
    [],
  );

  /** Runs after every queued write, on the real repository. */
  const onStored = useCallback(
    <R,>(op: (repo: ItemRepository) => Promise<R>): Promise<R> => {
      const result = queue.tail.then(() => op(repository));
      queue.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [repository, queue],
  );

  const readStored = useCallback(
    () => onStored(repo => repo.listAll()),
    [onStored],
  );

  const completeStoredReminders = useCallback(
    async (ids: string[]) => {
      const wanted = new Set(ids);
      const updatedAt = new Date().toISOString();
      const seen = generation.current;
      await onStored(async repo => {
        for (const item of await repo.listAll()) {
          if (
            item.type === 'reminder' &&
            wanted.has(item.id) &&
            !item.completed
          ) {
            await repo.save({ ...item, completed: true, updatedAt });
          }
        }
        // Read and applied inside the queue. A local change made since this
        // was queued has its write behind it, so this read can't include it:
        // that write's step reloads instead.
        const stored = await repo.listAll();
        if (activeRepo.current === repository) {
          if (generation.current === seen) {
            setItems(stored);
          } else {
            stale.current = true;
          }
        }
      });
    },
    [onStored, repository, setItems],
  );

  const value = useMemo(
    () => ({
      items,
      sampleDataEnabled,
      setSampleDataEnabled,
      saveItem,
      deleteItem,
      togglePinned,
      setReminderCompleted,
      writeError,
      dismissWriteError,
      searchItems,
      readStored,
      completeStoredReminders,
    }),
    [
      items,
      sampleDataEnabled,
      setSampleDataEnabled,
      saveItem,
      deleteItem,
      togglePinned,
      setReminderCompleted,
      writeError,
      dismissWriteError,
      searchItems,
      readStored,
      completeStoredReminders,
    ],
  );

  return (
    <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>
  );
}

export function useItems(): ItemsContextValue {
  const context = useContext(ItemsContext);
  if (!context) {
    throw new Error('useItems must be used inside ItemsProvider');
  }
  return context;
}

export function useItemsOfType<T extends ItemType>(type: T): ItemOfType<T>[] {
  const { items } = useItems();
  return useMemo(
    () => items.filter((i): i is ItemOfType<T> => i.type === type),
    [items, type],
  );
}

export function useItem(id: string | undefined): Item | undefined {
  const { items } = useItems();
  return useMemo(() => items.find(i => i.id === id), [items, id]);
}

/** New item id: UUIDv7 with randomness from the platform's secure generator. */
export function createId(): string {
  return uuidv7(Date.now(), vault.randomBytes(10));
}

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching'; results: Item[] }
  | { status: 'done'; results: Item[] }
  | { status: 'error' };

const SEARCH_DELAY_MS = 150;

/**
 * Debounced search through the repository. Re-runs when stored items change
 * (e.g. after editing a result), ignores out-of-date responses, and reports
 * failures instead of showing an empty result.
 */
export function useItemSearch(query: string): SearchState {
  const { searchItems, items } = useItems();
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const term = query.trim();

  useEffect(() => {
    if (!term) {
      setState({ status: 'idle' });
      return;
    }
    let current = true;
    setState(prev => ({
      status: 'searching',
      results:
        prev.status === 'done' || prev.status === 'searching'
          ? prev.results
          : [],
    }));
    const timer = setTimeout(() => {
      searchItems(term).then(
        results => current && setState({ status: 'done', results }),
        () => current && setState({ status: 'error' }),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, items, searchItems]);

  return state;
}
