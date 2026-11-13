import type { Item } from '../../data/types';
import { BackupError } from '../../backup/platform';
import { RestoreError } from '../../backup/restorePlatform';
import { strings } from '../../i18n/strings';

/**
 * What the backup, Check and restore screens say for each error code (Phase 6
 * spec v2.4 §3.11, §4.2, §6, §8), in the app language. Codes and ids only
 * ever reach this text, never a log.
 */
type ErrorTexts = ReturnType<typeof strings>['backupErrors'];
type CodeText = Exclude<
  keyof ErrorTexts,
  'generic' | 'attachment' | 'destinationRemains'
>;

function byCode(code: string): string {
  const t = strings().backupErrors;
  return code in t &&
    code !== 'generic' &&
    code !== 'attachment' &&
    code !== 'destinationRemains'
    ? t[code as CodeText]
    : t.generic;
}

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
  return strings().backupErrors.attachment(
    file?.fileName ?? null,
    item?.title ?? null,
    a?.reason ?? null,
  );
}

export function backupErrorMessage(error: unknown, items: Item[]): string {
  const e = BackupError.from(error);
  const text =
    e.code === 'BACKUP_ATTACHMENT_UNREADABLE'
      ? attachmentMessage(e, items)
      : byCode(e.code);
  return e.destination === 'remains'
    ? `${text} ${strings().backupErrors.destinationRemains}`
    : text;
}

export function restoreErrorMessage(error: unknown): string {
  return byCode(RestoreError.from(error).code);
}
