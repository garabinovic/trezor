import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { createSampleItems } from './sampleData';
import { Item, ItemOfType, ItemType } from './types';

/**
 * Phase 0 session store. Holds items in memory only — nothing is written to
 * disk and everything resets when the app closes. Phase 1 replaces the
 * internals with real local persistence while keeping this interface.
 */
interface ItemsContextValue {
  items: Item[];
  sampleDataEnabled: boolean;
  setSampleDataEnabled: (enabled: boolean) => void;
  saveItem: (item: Item) => void;
  deleteItem: (id: string) => void;
  togglePinned: (id: string) => void;
  setReminderCompleted: (id: string, completed: boolean) => void;
}

const ItemsContext = createContext<ItemsContextValue | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [sampleDataEnabled, setSampleDataEnabledState] = useState(true);
  const [items, setItems] = useState<Item[]>(() => createSampleItems());

  const setSampleDataEnabled = useCallback((enabled: boolean) => {
    setSampleDataEnabledState(enabled);
    setItems(enabled ? createSampleItems() : []);
  }, []);

  const saveItem = useCallback((item: Item) => {
    setItems(current => {
      const exists = current.some(i => i.id === item.id);
      return exists
        ? current.map(i => (i.id === item.id ? item : i))
        : [item, ...current];
    });
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems(current => current.filter(i => i.id !== id));
  }, []);

  const update = useCallback((id: string, change: (item: Item) => Item) => {
    setItems(current =>
      current.map(i =>
        i.id === id ? { ...change(i), updatedAt: new Date().toISOString() } : i,
      ),
    );
  }, []);

  const togglePinned = useCallback(
    (id: string) => update(id, i => ({ ...i, pinned: !i.pinned })),
    [update],
  );

  const setReminderCompleted = useCallback(
    (id: string, completed: boolean) =>
      update(id, i => (i.type === 'reminder' ? { ...i, completed } : i)),
    [update],
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
    }),
    [
      items,
      sampleDataEnabled,
      setSampleDataEnabled,
      saveItem,
      deleteItem,
      togglePinned,
      setReminderCompleted,
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

export function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
