import NativeTrezorBackup from '../native/NativeTrezorBackup';

/** Why a backup or a check failed (spec v2.4 §3.11, §4.2, §6). */
export type BackupErrorCode =
  | 'PASSWORD_INVALID'
  | 'PASSWORD_CHARACTER'
  | 'PASSWORD_LENGTH'
  | 'PASSWORD_MISMATCH'
  | 'BACKUP_UNSUPPORTED'
  | 'BACKUP_CORRUPT'
  | 'BACKUP_PASSWORD_OR_HEADER'
  | 'BACKUP_TOO_LARGE'
  | 'BACKUP_INSUFFICIENT_MEMORY'
  | 'BACKUP_INCONSISTENT'
  | 'BACKUP_ATTACHMENT_UNREADABLE'
  | 'INSUFFICIENT_SPACE'
  | 'DESTINATION_NOT_EMPTY'
  | 'DESTINATION_UNVERIFIED'
  | 'KEY_UNAVAILABLE'
  | 'NO_ACTIVITY'
  | 'BUSY'
  | 'PICKER_UNAVAILABLE'
  | 'BACKUP_FAILED';

const codes = new Set<string>([
  'PASSWORD_INVALID',
  'PASSWORD_CHARACTER',
  'PASSWORD_LENGTH',
  'PASSWORD_MISMATCH',
  'BACKUP_UNSUPPORTED',
  'BACKUP_CORRUPT',
  'BACKUP_PASSWORD_OR_HEADER',
  'BACKUP_TOO_LARGE',
  'BACKUP_INSUFFICIENT_MEMORY',
  'BACKUP_INCONSISTENT',
  'BACKUP_ATTACHMENT_UNREADABLE',
  'INSUFFICIENT_SPACE',
  'DESTINATION_NOT_EMPTY',
  'DESTINATION_UNVERIFIED',
  'KEY_UNAVAILABLE',
  'NO_ACTIVITY',
  'BUSY',
  'PICKER_UNAVAILABLE',
  'BACKUP_FAILED',
]);

/** A file a failed backup left: deleted, or still there because the provider refused. */
export type DestinationOutcome = 'deleted' | 'remains' | 'none';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    /** BACKUP_ATTACHMENT_UNREADABLE: which attachment, of which item, and why. */
    readonly attachment?: {
      attachmentId: string;
      itemId: string;
      reason: 'MISSING' | 'DAMAGED' | 'MISMATCH';
    },
    /** For a failed backup: what became of the partly written file. */
    readonly destination?: DestinationOutcome,
  ) {
    super(code);
    this.name = 'BackupError';
  }

  /** Any rejection or thrown error as a BackupError; never carries user data in its text. */
  static from(e: unknown, destination?: DestinationOutcome): BackupError {
    if (e instanceof BackupError) {
      return destination === undefined
        ? e
        : new BackupError(e.code, e.attachment, destination);
    }
    const raw = (e as { code?: unknown; message?: unknown } | null) ?? {};
    const code =
      typeof raw.code === 'string' && codes.has(raw.code)
        ? (raw.code as BackupErrorCode)
        : 'BACKUP_FAILED';
    let attachment: BackupError['attachment'];
    if (
      code === 'BACKUP_ATTACHMENT_UNREADABLE' &&
      typeof raw.message === 'string'
    ) {
      try {
        attachment = JSON.parse(raw.message);
      } catch {
        attachment = undefined;
      }
    }
    return new BackupError(code, attachment, destination);
  }
}

/** One attachment row of a database artifact (or a staged check's manifest entry). */
export interface ArtifactAttachment {
  id: string;
  itemId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  formatVersion: number;
}

/** A backup's database artifact staged by native code, to be checked with SQLCipher here. */
export interface Staged {
  checkId: string;
  /** Absolute directory of the staged artifact. */
  location: string;
  name: string;
  /** The backup's SQLCipher artifact key (hex). */
  key: string;
  backupId: string;
  trailer: string;
  schemaVersion: number;
  attachments: ArtifactAttachment[];
}

export interface Begun {
  sessionId: string;
  location: string;
  exportName: string;
  key: string;
}

/** The native half (TrezorBackupModule). Replaceable in tests. */
export interface BackupPlatform {
  validatePassword(password: string, confirmation: string): Promise<void>;
  beginBackup(password: string, confirmation: string): Promise<Begun>;
  pickDestination(
    sessionId: string,
    suggestedName: string,
  ): Promise<'picked' | 'cancelled'>;
  writeBackup(sessionId: string, rows: ArtifactAttachment[]): Promise<number>;
  readBack(sessionId: string): Promise<Staged>;
  completeBackup(sessionId: string): Promise<void>;
  abortBackup(sessionId: string): Promise<DestinationOutcome>;
  pickBackupFile(): Promise<string | null>;
  checkBackup(uri: string, password: string): Promise<Staged>;
  finishCheck(checkId: string): Promise<void>;
  takeIncompleteNotice(): Promise<string | null>;
}

const native = <T>(run: () => Promise<T>): Promise<T> =>
  run().catch(e => {
    throw BackupError.from(e);
  });

export const nativeBackupPlatform: BackupPlatform = {
  validatePassword: (p, c) =>
    native(() => NativeTrezorBackup.validatePassword(p, c)),
  beginBackup: (p, c) =>
    native(async () => JSON.parse(await NativeTrezorBackup.beginBackup(p, c))),
  pickDestination: (id, name) =>
    native(async () =>
      (await NativeTrezorBackup.pickDestination(id, name)) === 'picked'
        ? 'picked'
        : 'cancelled',
    ),
  writeBackup: (id, rows) =>
    native(() => NativeTrezorBackup.writeBackup(id, JSON.stringify(rows))),
  readBack: id =>
    native(async () => JSON.parse(await NativeTrezorBackup.readBack(id))),
  completeBackup: id => native(() => NativeTrezorBackup.completeBackup(id)),
  abortBackup: id =>
    native(
      async () =>
        (await NativeTrezorBackup.abortBackup(id)) as DestinationOutcome,
    ),
  pickBackupFile: () =>
    native(async () => (await NativeTrezorBackup.pickBackupFile()) || null),
  checkBackup: (uri, p) =>
    native(async () =>
      JSON.parse(await NativeTrezorBackup.checkBackup(uri, p)),
    ),
  finishCheck: id => native(() => NativeTrezorBackup.finishCheck(id)),
  takeIncompleteNotice: () =>
    native(
      async () => (await NativeTrezorBackup.takeIncompleteNotice()) || null,
    ),
};
