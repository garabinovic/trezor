import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { StorageError, toStorageError } from './errors';
import { OpenedStorage, openStorage } from './openStorage';

export type StorageState =
  | { status: 'opening' }
  | { status: 'error'; error: StorageError }
  | { status: 'ready'; storage: OpenedStorage };

interface StorageContextValue {
  state: StorageState;
  /** Tries to open storage again after an error. Never deletes anything. */
  retry: () => void;
}

const StorageContext = createContext<StorageContextValue | null>(null);

export function StorageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StorageState>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    openStorage()
      .then(storage => {
        if (!cancelled) {
          setState({ status: 'ready', storage });
        }
      })
      .catch(e => {
        if (!cancelled) {
          const error = toStorageError(e);
          // Code and message only: never key material or user content.
          console.warn(`[storage] open failed: ${error.code}`);
          setState({ status: 'error', error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'opening' });
    setAttempt(a => a + 1);
  }, []);

  return (
    <StorageContext.Provider value={{ state, retry }}>
      {children}
    </StorageContext.Provider>
  );
}

export function useStorage(): StorageContextValue {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be used inside StorageProvider');
  }
  return context;
}
