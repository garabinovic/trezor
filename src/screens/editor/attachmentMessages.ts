import type {
  AttachmentErrorCode,
  ImportFailureCode,
} from '../../attachments/platform';

/** What the picker was for: card photos take images only. */
export type PickKind = 'photo' | 'file';

/** Why one picked file was not added, in a sentence. */
export function importFailureText(
  failure: { fileName: string; code: ImportFailureCode },
  kind: PickKind = 'photo',
): string {
  const name = `“${failure.fileName}”`;
  switch (failure.code) {
    case 'TOO_LARGE':
      return `${name} is larger than 25 MB.`;
    case 'UNSUPPORTED_TYPE':
      return kind === 'photo'
        ? `${name} isn’t a supported photo. Use JPEG, PNG, WebP or HEIC.`
        : `${name} isn’t supported. Use a photo (JPEG, PNG, WebP, HEIC) or a PDF.`;
    case 'READ_FAILED':
      return `${name} couldn’t be read.`;
    case 'IMPORT_FAILED':
      return `${name} couldn’t be saved. Try again.`;
  }
}

/** Why the picker could not be used at all; null when nothing needs saying. */
export function pickErrorText(
  code: AttachmentErrorCode,
  kind: PickKind = 'photo',
): string | null {
  switch (code) {
    case 'BUSY':
      return null;
    case 'KEY_UNAVAILABLE':
      return `${
        kind === 'photo' ? 'Photos' : 'Files'
      } can’t be added: the encryption key is unavailable.`;
    case 'PICKER_UNAVAILABLE':
      return `No ${
        kind === 'photo' ? 'photo' : 'file'
      } picker is available on this device.`;
    default:
      return `The ${kind} couldn’t be added. Try again.`;
  }
}

/** Files picked beyond the per-document limit. */
export function skippedText(skipped: number, limit: number): string {
  return `${skipped} ${
    skipped === 1 ? 'file wasn’t' : 'files weren’t'
  } added: a document can have at most ${limit} attachments.`;
}
