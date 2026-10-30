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
 * and written to the repository in order; if a write fails, state is reloaded
 * from storage and `writeError` is set so the UI can tell the user.
 */
interface ItemsContextValue {
  items: Item[];
  /** Development builds only: show in-memory sample data instead of saved items. */
  sampleDataEnabled: boolean;
  setSampleDataEnabled: (enabled: boolean) => void;
  saveItem: (item: Item) => void;
  deleteItem: (id: string) => void;
  togglePinned: (id: string) => void;
  setReminderCompleted: (id: string, completed: boolean) => void;
  writeError: boolean;
  dismissWriteError: () => void;
  /** Searches the active repository (the encrypted database in normal use). */
  searchItems: (term: string) => Promise<Item[]>;
}

const ItemsContext = createContext<ItemsContextValue | null>(null);

interface ItemsProviderProps {
  /** Persistent storage for the user's items. */
  repository: ItemRepository;
  /** Items already loaded from `repository`, so the first render is complete. */
  initialItems: Item[];
  children: ReactNode;
}

export function ItemsProvider({
  repository,
  initialItems,
  children,
}: ItemsProviderProps) {
  const [items, setItemsState] = useState<Item[]>(initialItems);
  const [sampleDataEnabled, setSampleDataEnabledState] = useState(false);
  const [writeError, setWriteError] = useState(false);

  // Refs give callbacks the latest values without re-creating them.
  const itemsRef = useRef(items);
  const activeRepo = useRef<ItemRepository>(repository);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  const setItems = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  /** Applies a change locally, then persists it after any earlier writes. */
  const commit = useCallback(
    (next: Item[], write: (repo: ItemRepository) => Promise<void>) => {
      const repo = activeRepo.current;
      setItems(next);
      writeQueue.current = writeQueue.current
        .then(() => write(repo))
        .catch(async () => {
          setWriteError(true);
          // Fall back to what is actually stored.
          try {
            const stored = await repo.listAll();
            if (activeRepo.current === repo) {
              setItems(stored);
            }
          } catch {
            // Keep current state; the error dialog is already showing.
          }
        });
    },
    [setItems],
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
      writeQueue.current = writeQueue.current
        .then(() => repo.listAll())
        .then(loaded => {
          if (activeRepo.current === repo) {
            setItems(loaded);
          }
        })
        .catch(() => setWriteError(true));
    },
    [repository, setItems],
  );

  const saveItem = useCallback(
    (item: Item) => {
      const current = itemsRef.current;
      const exists = current.some(i => i.id === item.id);
      commit(
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
