import type { Attachment, AttachmentMimeType, Item } from './types';

/** Per attachment (plaintext). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_ATTACHMENTS = 10;
/** Format written by the native attachment store (TZA v1). */
export const ATTACHMENT_FORMAT_VERSION = 1;

export const ATTACHMENT_MIME_TYPES: readonly AttachmentMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

export type AttachmentRole = 'card_front' | 'card_back' | 'document';

export const isImage = (a: Pick<Attachment, 'mimeType'>) =>
  a.mimeType.startsWith('image/');

/** An item's attachments with their storage role and position. */
export function placedAttachments(
  item: Item,
): { attachment: Attachment; role: AttachmentRole; position: number }[] {
  switch (item.type) {
    case 'card':
      return [
        ...(item.frontImage
          ? [{ attachment: item.frontImage, role: 'card_front' as const }]
          : []),
        ...(item.backImage
          ? [{ attachment: item.backImage, role: 'card_back' as const }]
          : []),
      ].map(p => ({ ...p, position: 0 }));
    case 'document':
      return item.attachments.map((attachment, position) => ({
        attachment,
        role: 'document' as const,
        position,
      }));
    default:
      return [];
  }
}

export const attachmentIdsOf = (item: Item) =>
  placedAttachments(item).map(p => p.attachment.id);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An attachment id: a lowercase UUID, which is also all a file name can be. */
export const isAttachmentId = (id: unknown): id is string =>
  typeof id === 'string' && UUID.test(id);
const SHA256 = /^[0-9a-f]{64}$/;

/** Why one attachment record is invalid, or null if it is valid. */
export function attachmentRecordProblem(a: Attachment): string | null {
  if (!UUID.test(a.id)) {
    return 'Invalid attachment id';
  }
  if (!ATTACHMENT_MIME_TYPES.includes(a.mimeType)) {
    return 'Unsupported attachment type';
  }
  if (
    !Number.isInteger(a.sizeBytes) ||
    a.sizeBytes < 0 ||
    a.sizeBytes > MAX_ATTACHMENT_BYTES
  ) {
    return 'Attachment too large';
  }
  if (!Number.isInteger(a.formatVersion) || a.formatVersion < 1) {
    return 'Invalid attachment format';
  }
  if (!SHA256.test(a.sha256)) {
    return 'Invalid attachment checksum';
  }
  if (typeof a.fileName !== 'string' || !a.fileName.trim()) {
    return 'Attachment needs a file name';
  }
  return null;
}

/** Why an item's attachments can't be stored, or null if they can. */
export function attachmentProblem(item: Item): string | null {
  if (
    item.type === 'document' &&
    item.attachments.length > MAX_DOCUMENT_ATTACHMENTS
  ) {
    return `At most ${MAX_DOCUMENT_ATTACHMENTS} attachments per document`;
  }
  const seen = new Set<string>();
  for (const { attachment: a, role } of placedAttachments(item)) {
    const problem = attachmentRecordProblem(a);
    if (problem) {
      return problem;
    }
    if (seen.has(a.id)) {
      return 'Duplicate attachment';
    }
    seen.add(a.id);
    if (role !== 'document' && !isImage(a)) {
      return 'Card images must be images';
    }
  }
  return null;
}
