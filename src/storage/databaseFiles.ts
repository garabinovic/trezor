import NativeTrezorDatabaseFiles from '../native/NativeTrezorDatabaseFiles';
import { StorageError, toStorageError } from './errors';

export type FileState = 'present' | 'absent';

/** Files in the app's private database directory (where op-sqlite opens by name). */
export const databaseFiles = {
  /** Never reports 'absent' unless the native side proved it. */
  async state(name: string): Promise<FileState> {
    let state: string;
    try {
      state = await NativeTrezorDatabaseFiles.fileState(name);
    } catch (e) {
      throw toStorageError(e, 'DATABASE_STATE_UNKNOWN');
    }
    if (state !== 'present' && state !== 'absent') {
      throw new StorageError(
        'DATABASE_STATE_UNKNOWN',
        `Unexpected file state for ${name}`,
      );
    }
    return state;
  },

  async renameNoReplace(from: string, to: string): Promise<void> {
    try {
      await NativeTrezorDatabaseFiles.renameNoReplace(from, to);
    } catch (e) {
      throw toStorageError(e, 'STORAGE_ERROR');
    }
  },

  async deleteTemporary(name: string): Promise<void> {
    try {
      await NativeTrezorDatabaseFiles.deleteTemporary(name);
    } catch (e) {
      throw toStorageError(e, 'STORAGE_ERROR');
    }
  },
};
