import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Encrypted attachment files (android/app/src/main/java/com/trezor/app/attachments).
 * File bytes never cross into JavaScript; only metadata does.
 */
export interface Spec extends TurboModule {
  /**
   * Opens the Photo Picker ('photos', images only) or the system document
   * picker ('files') and encrypts what the user picks, at most `maxCount`
   * files. Resolves with JSON `{ imported, failed, skipped }`; cancelling
   * resolves with nothing imported. Rejects with BUSY, NO_ACTIVITY,
   * PICKER_UNAVAILABLE, KEY_UNAVAILABLE or INVALID_ARGUMENT.
   */
  pick(source: string, imagesOnly: boolean, maxCount: number): Promise<string>;
  /** Deletes these attachments' files (idempotent). Resolves with how many existed. */
  deleteFiles(ids: string[]): Promise<number>;
  /**
   * Deletes files of attachments not in `knownIds` and unfinished imports.
   * Startup only, with the database's complete list of attachment ids.
   */
  collectGarbage(knownIds: string[]): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorAttachments');
