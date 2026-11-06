import { SerialDatabase } from '../storage/serialDatabase';
import {
  exportDatabase,
  requireSameAttachments,
  verifyArtifact,
} from './artifact';
import {
  BackupError,
  BackupPlatform,
  nativeBackupPlatform,
  Staged,
} from './platform';

export type CreateResult =
  | { status: 'created'; bytes: number; backupId: string }
  | { status: 'cancelled' };

export type CheckResult =
  | { status: 'valid'; backupId: string; trailer: string; attachments: number }
  | { status: 'cancelled' };

/**
 * Checks a staged database artifact (spec v2.4 §7 step 6, Annex B §B.4) against its
 * manifest. Always deletes the staged files, whatever the outcome.
 */
async function checkStaged(
  platform: BackupPlatform,
  staged: Staged,
): Promise<void> {
  try {
    if (staged.schemaVersion !== 3) {
      throw new BackupError('BACKUP_UNSUPPORTED');
    }
    const rows = await verifyArtifact(staged.location, staged.name, staged.key);
    requireSameAttachments(rows, staged.attachments);
  } finally {
    await platform.finishCheck(staged.checkId);
  }
}

/**
 * Creates a backup (spec v2.4 §6.2):
 * 1. password, free space and keys (native);
 * 2. the destination, which must be empty;
 * 3. the backup gate: one exclusive operation on the live queue, held until the output is
 *    closed. Inside it, the export, its verification, and the complete file write (where
 *    native code also defers deletion of every exported attachment). Database work queued
 *    meanwhile waits and runs after it;
 * 4. the complete file read back and checked as by Check backup.
 *
 * Success is reported only after 4. On any failure or cancellation the partial file is
 * deleted where the provider allows it ([BackupError.destination] says so), and the live
 * database and attachment files are unchanged.
 */
export async function createBackup(options: {
  database: SerialDatabase;
  password: string;
  confirmation: string;
  suggestedName: string;
  platform?: BackupPlatform;
}): Promise<CreateResult> {
  const platform = options.platform ?? nativeBackupPlatform;
  const begun = await platform
    .beginBackup(options.password, options.confirmation)
    .catch(e => {
      throw BackupError.from(e);
    });
  try {
    if (
      (await platform.pickDestination(
        begun.sessionId,
        options.suggestedName,
      )) === 'cancelled'
    ) {
      await platform.abortBackup(begun.sessionId);
      return { status: 'cancelled' };
    }
    const bytes = await options.database.exclusive(async live => {
      await exportDatabase(
        live,
        `${begun.location}/${begun.exportName}`,
        begun.key,
      );
      // The manifest and the attachment set come from the export, not the live database.
      const rows = await verifyArtifact(
        begun.location,
        begun.exportName,
        begun.key,
      );
      return platform.writeBackup(begun.sessionId, rows);
    });
    const staged = await platform.readBack(begun.sessionId);
    await checkStaged(platform, staged);
    await platform.completeBackup(begun.sessionId);
    return { status: 'created', bytes, backupId: staged.backupId };
  } catch (e) {
    let destination: 'deleted' | 'remains' | 'none' = 'remains';
    try {
      destination = await platform.abortBackup(begun.sessionId);
    } catch {
      // Unknown: report that a file may remain.
    }
    throw BackupError.from(e, destination);
  }
}

/**
 * Check backup (spec v2.4 §7): verifies a backup file completely without touching the live
 * database, attachment files, keys, reminders or settings. Staged files are deleted
 * whatever the outcome.
 */
export async function checkBackup(options: {
  password: string;
  platform?: BackupPlatform;
}): Promise<CheckResult> {
  const platform = options.platform ?? nativeBackupPlatform;
  const uri = await platform.pickBackupFile();
  if (!uri) {
    return { status: 'cancelled' };
  }
  try {
    const staged = await platform.checkBackup(uri, options.password);
    await checkStaged(platform, staged);
    return {
      status: 'valid',
      backupId: staged.backupId,
      trailer: staged.trailer,
      attachments: staged.attachments.length,
    };
  } catch (e) {
    throw BackupError.from(e);
  }
}
