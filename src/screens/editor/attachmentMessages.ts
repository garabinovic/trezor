import type {
  AttachmentErrorCode,
  ImportFailureCode,
} from '../../attachments/platform';

/** Why one picked file was not added, in a sentence. */
export function importFailureText(failure: {
  fileName: string;
  code: ImportFailureCode;
}): string {
  const name = `“${failure.fileName}”`;
  switch (failure.code) {
    case 'TOO_LARGE':
      return `${name} is larger than 25 MB.`;
    case 'UNSUPPORTED_TYPE':
      return `${name} isn’t a supported photo. Use JPEG, PNG, WebP or HEIC.`;
    case 'READ_FAILED':
      return `${name} couldn’t be read.`;
    case 'IMPORT_FAILED':
      return `${name} couldn’t be saved. Try again.`;
  }
}

/** Why the picker could not be used at all; null when nothing needs saying. */
export function pickErrorText(code: AttachmentErrorCode): string | null {
  switch (code) {
    case 'BUSY':
      return null;
    case 'KEY_UNAVAILABLE':
      return 'Photos can’t be added: the encryption key is unavailable.';
    case 'PICKER_UNAVAILABLE':
      return 'No photo picker is available on this device.';
    default:
      return 'The photo couldn’t be added. Try again.';
  }
}
