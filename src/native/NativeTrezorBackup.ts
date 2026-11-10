import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Backup creation and Check backup, native half (Phase 6 spec v2.4 §6, §7;
 * android/app/src/main/java/com/trezor/app/backup/TrezorBackupModule.kt).
 * SQLCipher work stays in JS (op-sqlite); see src/backup/. Structured results
 * are JSON strings. Errors reject with a code; BACKUP_ATTACHMENT_UNREADABLE
 * and INSUFFICIENT_SPACE carry JSON details in their message.
 */
export interface Spec extends TurboModule {
  /** Rejects with PASSWORD_INVALID, PASSWORD_CHARACTER, PASSWORD_LENGTH or PASSWORD_MISMATCH. */
  validatePassword(password: string, confirmation: string): Promise<void>;
  /**
   * Password rules, free space, Argon2id, new keys. JSON:
   * { sessionId, location, exportName, key } (key: the SQLCipher artifact key, hex).
   */
  beginBackup(password: string, confirmation: string): Promise<string>;
  /** Opens the save-to picker: 'picked' or 'cancelled'. The document must be empty. */
  pickDestination(sessionId: string, suggestedName: string): Promise<string>;
  /** Writes the complete backup from the export and its rows (JSON array); returns its length. */
  writeBackup(sessionId: string, rowsJson: string): Promise<number>;
  /** Reads the written file back; JSON staged check (see Staged in src/backup/platform.ts). */
  readBack(sessionId: string): Promise<string>;
  completeBackup(sessionId: string): Promise<void>;
  /** 'deleted' | 'remains' | 'none'. */
  abortBackup(sessionId: string): Promise<string>;
  /** Opens the file picker: the document URI, or '' when cancelled. */
  pickBackupFile(): Promise<string>;
  /** Check backup, file half: JSON staged check. */
  checkBackup(uri: string, password: string): Promise<string>;
  /** Deletes a staged check. */
  finishCheck(checkId: string): Promise<void>;
  /** The name of a partial backup a previous run couldn't delete (once), or ''. */
  takeIncompleteNotice(): Promise<string>;
  /** The app's version, as backups record it. JSON: { versionName, versionCode }. */
  appVersion(): string;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorBackup');
