import type {
  AttachmentErrorCode,
  ImportFailureCode,
} from '../../attachments/platform';
import { strings } from '../../i18n/strings';

/** What the picker was for: card photos take images only. */
export type PickKind = 'photo' | 'file';

/** Why one picked file was not added, in a sentence. */
export function importFailureText(
  failure: { fileName: string; code: ImportFailureCode },
  kind: PickKind = 'photo',
): string {
  const t = strings().editor.importFailure;
  const name = failure.fileName;
  switch (failure.code) {
    case 'TOO_LARGE':
      return t.tooLarge(name);
    case 'UNSUPPORTED_TYPE':
      return kind === 'photo'
        ? t.unsupportedPhoto(name)
        : t.unsupportedFile(name);
    case 'READ_FAILED':
      return t.readFailed(name);
    case 'IMPORT_FAILED':
      return t.importFailed(name);
  }
}

/** Why the picker could not be used at all; null when nothing needs saying. */
export function pickErrorText(
  code: AttachmentErrorCode,
  kind: PickKind = 'photo',
): string | null {
  const t = strings().editor.pickError;
  const photo = kind === 'photo';
  switch (code) {
    case 'BUSY':
      return null;
    case 'KEY_UNAVAILABLE':
      return photo ? t.photosKeyUnavailable : t.filesKeyUnavailable;
    case 'PICKER_UNAVAILABLE':
      return photo ? t.noPhotoPicker : t.noFilePicker;
    default:
      return photo ? t.photoFailed : t.fileFailed;
  }
}

/** Files picked beyond the per-document limit. */
export function skippedText(skipped: number, limit: number): string {
  return strings().editor.skipped(skipped, limit);
}
