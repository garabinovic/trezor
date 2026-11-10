import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Restore and its recovery, native half (Phase 6 spec v2.4 §8, v2.5;
 * android/app/src/main/java/com/trezor/app/restore/TrezorRestoreModule.kt).
 * SQLCipher work stays in JS (src/backup/restore.ts, src/backup/recovery.ts).
 * Structured results are JSON strings; errors reject with a code
 * (INSUFFICIENT_SPACE carries JSON).
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
  /**
   * Steps 13a–15 after the live connection was closed: 'verifying', or
   * 'rolledback' when a failed rename was rolled back in this process.
   */
  swapRestore(sessionId: string): Promise<string>;
  /** §8.10: ends the process (relaunching only from the foreground). */
  restartProcess(): Promise<void>;
  /**
   * v2.5 §5: starts a recovery run and returns its token, or rejects with
   * RESTORE_IN_PROGRESS while any run or restore holds the lock. Every
   * recovery call below takes that token.
   */
  recoveryBegin(): Promise<string>;
  /**
   * v2.5 §7: runs recovery rows until startup may continue, JSON { status:
   * 'done' } or { status: 'verify', location, name, attachmentIds }.
   */
  recoveryRun(token: string): Promise<string>;
  /** 'pass' | 'fail' | 'retry' | 'unavailable' (v2.5 §1.3). */
  finishVerification(token: string, outcome: string): Promise<void>;
  /**
   * v2.5 §2.1: JSON { location, name, attachmentIds } of the previous data,
   * or RESTORE_CANCEL_UNAVAILABLE.
   */
  previousData(token: string): Promise<string>;
  /** v2.5 §2.2: writes `rollingback`; the next recovery run rolls back. */
  cancelRestore(token: string): Promise<void>;
  /** Ends the run of `token`; another token changes nothing. */
  recoveryEnd(token: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorRestore');
