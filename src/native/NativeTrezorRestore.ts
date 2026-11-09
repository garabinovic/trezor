import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Restore preparation, native half (Phase 6 spec v2.4 §8.1–8.4, §8.6–8.11;
 * android/app/src/main/java/com/trezor/app/restore/TrezorRestoreModule.kt).
 * SQLCipher work stays in JS (src/backup/restore.ts). Structured results are
 * JSON strings; errors reject with a code (INSUFFICIENT_SPACE carries JSON).
 *
 * Step 3: no method replaces live data. The swap, recovery and the call to
 * restartProcess are Step 4.
 */
export interface Spec extends TurboModule {
  /** §8.1: JSON { status: 'ready' | 'notOffered' | 'refused', code? }. */
  preflight(fromErrorScreen: boolean): Promise<string>;
  /** Step 1 for the document at `uri`: JSON { sessionId, backupId, attachments, databaseBytes }. */
  beginRestore(uri: string, password: string): Promise<string>;
  /** Takes the native restore gate and waits for attachment work already accepted. */
  acquireGate(): Promise<void>;
  /** Shares still being prepared or launched. */
  activeShareCount(): Promise<number>;
  /**
   * Steps 3–5 ('' for no preceding Check). JSON { restoreId, backupId, trailer,
   * location, incoming, staged, key, schemaVersion, attachments }.
   */
  stageRestore(
    sessionId: string,
    expectedBackupId: string,
    expectedTrailer: string,
  ): Promise<string>;
  /** End of step 6. */
  deleteIncoming(sessionId: string): Promise<void>;
  /** Steps 7–8: JSON { linked, copied, missing, failClosed }. */
  preserveRetained(sessionId: string): Promise<string>;
  /** Steps 10–11, one call under the schedule lock: 'saved' | 'absent'. */
  saveAndClearSchedule(sessionId: string): Promise<string>;
  /** Step 12. */
  purgeCaches(): Promise<void>;
  /** The pre-swap failure path. */
  abortRestore(sessionId: string): Promise<void>;
  releaseGate(): Promise<void>;
  /** §8.10, for Step 4: ends the process (relaunching only from the foreground). */
  restartProcess(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorRestore');
