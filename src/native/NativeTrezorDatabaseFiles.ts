import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * File operations in the app's private database directory
 * (android/app/src/main/java/com/trezor/app/storage/DatabaseFiles.kt).
 * Names are bare file names (`trezor.db`), never paths.
 */
export interface Spec extends TurboModule {
  /**
   * 'present' | 'absent'. Rejects with DATABASE_STATE_UNKNOWN when the answer
   * cannot be determined (I/O or permission problem); never guesses 'absent'.
   */
  fileState(name: string): Promise<string>;
  /** Atomic rename; rejects if `to` already exists. */
  renameNoReplace(from: string, to: string): Promise<void>;
  /** Deletes a `*.partial.db` file and its side files; rejects any other name. */
  deleteTemporary(name: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorDatabaseFiles');
