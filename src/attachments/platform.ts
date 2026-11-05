import { attachmentRecordProblem, isAttachmentId } from '../data/attachments';
import type { Attachment } from '../data/types';
import NativeTrezorAttachments from '../native/NativeTrezorAttachments';

/** 'photos': Android's Photo Picker; 'files': the system document picker. */
export type PickSource = 'photos' | 'files';

/** Why one picked file was not added (mirrors AttachmentImporter.Code). */
export type ImportFailureCode =
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'READ_FAILED'
  | 'IMPORT_FAILED';

export interface PickResult {
  /** Encrypted and stored; not yet referenced by any saved item. */
  imported: Attachment[];
  failed: { fileName: string; code: ImportFailureCode }[];
  /** Picked beyond `maxCount`, and not imported. */
  skipped: number;
}

export type AttachmentErrorCode =
  | 'BUSY'
  | 'NO_ACTIVITY'
  | 'PICKER_UNAVAILABLE'
  | 'KEY_UNAVAILABLE'
  | 'INVALID_ARGUMENT'
  | 'IO_FAILED'
  /** The encrypted file is gone. */
  | 'MISSING'
  /** The file is damaged or doesn't match its record. */
  | 'DAMAGED'
  /** A PDF that needs a password. */
  | 'PDF_PROTECTED'
  /** A PDF Android's renderer can't read. */
  | 'PDF_UNSUPPORTED'
  /** Save a copy: the chosen document already had content; nothing written. */
  | 'DESTINATION_NOT_EMPTY'
  /** Save a copy: the location doesn't report whether the file is new; nothing written. */
  | 'DESTINATION_UNVERIFIED'
  /** Save a copy failed; the partial copy was deleted. */
  | 'EXPORT_FAILED'
  /** Save a copy failed; the partial copy could not be deleted. */
  | 'EXPORT_INCOMPLETE'
  /** No app can receive a shared file. */
  | 'SHARE_UNAVAILABLE'
  | 'UNKNOWN';

const errorCodes = new Set<string>([
  'BUSY',
  'NO_ACTIVITY',
  'PICKER_UNAVAILABLE',
  'KEY_UNAVAILABLE',
  'INVALID_ARGUMENT',
  'IO_FAILED',
  'MISSING',
  'DAMAGED',
  'PDF_PROTECTED',
  'PDF_UNSUPPORTED',
  'DESTINATION_NOT_EMPTY',
  'DESTINATION_UNVERIFIED',
  'EXPORT_FAILED',
  'EXPORT_INCOMPLETE',
  'SHARE_UNAVAILABLE',
]);

const failureCodes = new Set<string>([
  'TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'READ_FAILED',
  'IMPORT_FAILED',
]);

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

export function toAttachmentError(error: unknown): AttachmentError {
  if (error instanceof AttachmentError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return new AttachmentError(
    typeof code === 'string' && errorCodes.has(code)
      ? (code as AttachmentErrorCode)
      : 'UNKNOWN',
    error instanceof Error ? error.message : 'Attachment error',
  );
}

/** A parsed pick, plus the files of records JS refused (to delete at once). */
export interface ParsedPick extends PickResult {
  rejectedIds: string[];
}

/**
 * Reads the native pick result. A record that fails `attachmentRecordProblem`
 * is not added: it is reported as that file's `IMPORT_FAILED`, and its id is
 * returned in `rejectedIds` so its encrypted file can be deleted.
 *
 * Only ids that can safely be deleted are returned: well-formed attachment ids
 * (so nothing else can be named), not also used by an accepted record or
 * another record of this result. Native import never overwrites an existing
 * file, so such an id names a file this pick created, never a saved
 * attachment or another draft's file.
 */
export function parsePickResult(json: string, createdAt: string): ParsedPick {
  let raw: {
    imported?: unknown[];
    failed?: unknown[];
    skipped?: unknown;
  };
  try {
    raw = JSON.parse(json);
  } catch {
    throw new AttachmentError('UNKNOWN', 'Malformed pick result');
  }
  const imported: Attachment[] = [];
  const rejected: { id: unknown; fileName: string }[] = [];
  const seen = new Map<string, number>();
  for (const entry of raw.imported ?? []) {
    const a = { ...(entry as Omit<Attachment, 'createdAt'>), createdAt };
    if (isAttachmentId(a.id)) {
      seen.set(a.id, (seen.get(a.id) ?? 0) + 1);
    }
    const duplicate = imported.some(i => i.id === a.id);
    if (!duplicate && attachmentRecordProblem(a) === null) {
      imported.push({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        formatVersion: a.formatVersion,
        createdAt,
      });
    } else {
      rejected.push({ id: a.id, fileName: displayName(a.fileName) });
    }
  }
  const accepted = new Set(imported.map(a => a.id));
  const rejectedIds = rejected
    .map(r => r.id)
    .filter(
      (id): id is string =>
        isAttachmentId(id) && !accepted.has(id) && seen.get(id) === 1,
    );
  const failed = [
    ...rejected.map(r => ({
      fileName: r.fileName,
      code: 'IMPORT_FAILED' as ImportFailureCode,
    })),
    ...(raw.failed ?? []).map(entry => {
      const f = entry as { fileName?: unknown; code?: unknown };
      return {
        fileName: displayName(f.fileName),
        code: (typeof f.code === 'string' && failureCodes.has(f.code)
          ? f.code
          : 'IMPORT_FAILED') as ImportFailureCode,
      };
    }),
  ];
  const skipped =
    typeof raw.skipped === 'number' && raw.skipped > 0 ? raw.skipped : 0;
  return { imported, failed, skipped, rejectedIds };
}

/** A name to show in a message; never used to find a file. */
function displayName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'File';
}

export interface OpenPdf {
  handle: string;
  /** Page sizes in points, in order. */
  pages: { width: number; height: number }[];
}

/** Encrypted attachment files, as seen by the app. Faked in tests. */
export interface AttachmentPlatform {
  pick(options: {
    source: PickSource;
    imagesOnly: boolean;
    maxCount: number;
  }): Promise<PickResult>;
  /**
   * Deletes files of attachments whose database rows are gone. Call only
   * after the write that removed them has committed.
   */
  deleteFiles(ids: string[]): Promise<void>;
  /**
   * A checked, decrypted copy in the app's private cache, for display only.
   * Close it as soon as it is no longer shown.
   */
  openView(attachment: Attachment): Promise<string>;
  closeView(uri: string): Promise<void>;
  /** A checked, decrypted PDF opened with Android's renderer. */
  openPdf(attachment: Attachment): Promise<OpenPdf>;
  /** One page as a private PNG; close it with `closeView` when not shown. */
  renderPdfPage(
    handle: string,
    index: number,
    widthPx: number,
  ): Promise<string>;
  /** Deletes the PDF copy and every page rendered from it. */
  closePdf(handle: string): Promise<void>;
  /** Deletes view files nothing holds (app back in the foreground). */
  purgeInactiveViews(): Promise<number>;
  /**
   * Lets the user pick where to save a decrypted copy (Storage Access
   * Framework). The original encrypted file is never changed.
   */
  saveCopy(attachment: Attachment): Promise<'saved' | 'cancelled'>;
  /** Opens the system share sheet for a checked, decrypted copy. */
  share(attachment: Attachment): Promise<void>;
  /** Deletes share copies older than 24 hours (startup and foreground). */
  purgeExpiredShares(): Promise<number>;
  /** Before a missing database is created: keeps every existing file. */
  keepUnreferenced(): Promise<number>;
  /**
   * Startup only: removes files no database row refers to (except kept
   * ones), and views. Once per process; -1 when it already ran.
   */
  collectGarbage(knownIds: string[]): Promise<number>;
}

export const nativeAttachmentPlatform: AttachmentPlatform = {
  async pick({ source, imagesOnly, maxCount }) {
    let json: string;
    try {
      json = await NativeTrezorAttachments.pick(source, imagesOnly, maxCount);
    } catch (e) {
      throw toAttachmentError(e);
    }
    const { rejectedIds, ...result } = parsePickResult(
      json,
      new Date().toISOString(),
    );
    if (rejectedIds.length > 0) {
      // A failed delete leaves them for the startup cleanup; the user has
      // already been told those files weren't added.
      await NativeTrezorAttachments.deleteFiles(rejectedIds).catch(() =>
        console.warn('[attachments] could not delete rejected import files'),
      );
    }
    return result;
  },

  async deleteFiles(ids) {
    if (ids.length === 0) {
      return;
    }
    try {
      await NativeTrezorAttachments.deleteFiles(ids);
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async openView({ id, sizeBytes, sha256 }) {
    try {
      return await NativeTrezorAttachments.openView(id, sizeBytes, sha256);
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async closeView(uri) {
    try {
      await NativeTrezorAttachments.closeView(uri);
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async openPdf({ id, sizeBytes, sha256 }) {
    let json: string;
    try {
      json = await NativeTrezorAttachments.openPdf(id, sizeBytes, sha256);
    } catch (e) {
      throw toAttachmentError(e);
    }
    const raw = JSON.parse(json) as { handle: string; pages: number[][] };
    return {
      handle: raw.handle,
      pages: raw.pages.map(([width, height]) => ({ width, height })),
    };
  },

  async renderPdfPage(handle, index, widthPx) {
    try {
      return await NativeTrezorAttachments.renderPdfPage(
        handle,
        index,
        widthPx,
      );
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async closePdf(handle) {
    try {
      await NativeTrezorAttachments.closePdf(handle);
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async saveCopy({ id, sizeBytes, sha256, fileName, mimeType }) {
    try {
      const result = await NativeTrezorAttachments.saveCopy(
        id,
        sizeBytes,
        sha256,
        fileName,
        mimeType,
      );
      return result === 'saved' ? 'saved' : 'cancelled';
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async share({ id, sizeBytes, sha256, fileName, mimeType }) {
    try {
      await NativeTrezorAttachments.share(
        id,
        sizeBytes,
        sha256,
        fileName,
        mimeType,
      );
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async purgeExpiredShares() {
    try {
      return await NativeTrezorAttachments.purgeExpiredShares();
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async purgeInactiveViews() {
    try {
      return await NativeTrezorAttachments.purgeInactiveViews();
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async keepUnreferenced() {
    try {
      return await NativeTrezorAttachments.keepUnreferenced();
    } catch (e) {
      throw toAttachmentError(e);
    }
  },

  async collectGarbage(knownIds) {
    try {
      return await NativeTrezorAttachments.collectGarbage(knownIds);
    } catch (e) {
      throw toAttachmentError(e);
    }
  },
};
