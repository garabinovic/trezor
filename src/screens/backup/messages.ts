import type { Item } from '../../data/types';
import { BackupError } from '../../backup/platform';
import { RestoreError } from '../../backup/restorePlatform';

/**
 * What the backup, Check and restore screens say for each error code (Phase 6
 * spec v2.4 §3.11, §4.2, §6, §8). Codes and ids only ever reach this text,
 * never a log.
 */
const byCode: Record<string, string> = {
  PASSWORD_INVALID:
    'The password contains a character that can’t be used. Type it again.',
  PASSWORD_CHARACTER:
    'The password contains a character that can’t be used, such as a control or formatting character.',
  PASSWORD_LENGTH: 'The password must be 10 to 256 characters long.',
  PASSWORD_MISMATCH: 'The two passwords don’t match.',
  BACKUP_PASSWORD_OR_HEADER:
    'The password is wrong, or this isn’t a Trezor backup file.',
  BACKUP_CORRUPT: 'The backup file is damaged or incomplete. It can’t be used.',
  BACKUP_INCONSISTENT:
    'The backup file’s contents don’t match each other. It can’t be used.',
  BACKUP_UNSUPPORTED:
    'This backup was made by a different version of Trezor and can’t be used here.',
  BACKUP_TOO_LARGE: 'The backup file is too large to use.',
  BACKUP_INSUFFICIENT_MEMORY:
    'There isn’t enough free memory right now. Close other apps and try again.',
  INSUFFICIENT_SPACE:
    'There isn’t enough free storage on this device. Free up some space and try again.',
  DESTINATION_NOT_EMPTY:
    'The chosen file isn’t empty. Choose a new file name instead.',
  DESTINATION_UNVERIFIED:
    'Trezor couldn’t verify the backup in that location. Choose a folder on this device’s own storage instead (in the file picker’s menu, the device’s name), then copy the backup wherever you like.',
  KEY_UNAVAILABLE:
    'Your attached files can’t be read with this device’s key. Nothing was changed.',
  NO_ACTIVITY: 'Trezor needs to be open in the foreground to choose a file.',
  BUSY: 'A file picker is already open.',
  PICKER_UNAVAILABLE: 'No app is available to choose a file.',
  BACKUP_CHANGED:
    'The backup file changed since it was checked. Choose it again and retry.',
  RESTORE_UNAVAILABLE:
    'Restoring isn’t possible: the encryption key on this device is missing or no longer valid. Nothing was changed.',
  RESTORE_STATE_UNKNOWN:
    'An earlier restore left files Trezor can’t account for, so it won’t start another one. Nothing was changed.',
  RESTORE_IN_PROGRESS: 'A restore is already in progress.',
  RESTORE_CANCELLED: 'The restore was cancelled. Nothing was changed.',
  RESTORE_RECOVERY_RETRY:
    'The restore was stopped, but Trezor couldn’t finish putting your data back in order. Try again.',
  STORAGE_ERROR:
    'Trezor couldn’t read your attached files. Nothing was changed.',
};

const GENERIC = 'Something went wrong. Nothing was changed.';

const reasons = {
  MISSING: 'is missing',
  DAMAGED: 'is damaged',
  MISMATCH: 'doesn’t match its record',
} as const;

/**
 * BACKUP_ATTACHMENT_UNREADABLE names the item and the file (§6.2 step 5), so
 * the user can open it and remove or replace the file.
 */
function attachmentMessage(error: BackupError, items: Item[]): string {
  const a = error.attachment;
  const item = a ? items.find(i => i.id === a.itemId) : undefined;
  const file =
    a && item && 'attachments' in item
      ? item.attachments.find(f => f.id === a.attachmentId)
      : undefined;
  const what = file ? `The file “${file.fileName}”` : 'An attached file';
  const where = item ? ` in “${item.title}”` : '';
  const why = a ? reasons[a.reason] : 'can’t be read';
  return `${what}${where} ${why}. Open the item, remove or replace the file, then back up again.`;
}

export function backupErrorMessage(error: unknown, items: Item[]): string {
  const e = BackupError.from(error);
  const text =
    e.code === 'BACKUP_ATTACHMENT_UNREADABLE'
      ? attachmentMessage(e, items)
      : byCode[e.code] ?? GENERIC;
  return e.destination === 'remains'
    ? `${text} An incomplete file may remain where you saved it; delete it there.`
    : text;
}

export function restoreErrorMessage(error: unknown): string {
  return byCode[RestoreError.from(error).code] ?? GENERIC;
}
