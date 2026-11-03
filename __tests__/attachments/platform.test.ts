import {
  AttachmentError,
  nativeAttachmentPlatform,
  parsePickResult,
} from '../../src/attachments/platform';
import { fakeAttachments } from '../../test-utils/fakeAttachments';

const ID = '01a1a0dd-991f-783c-9531-3fab9ef47901';
const NOW = '2026-11-03T12:00:00.000Z';

const native = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  fileName: 'scan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1234,
  sha256: 'b'.repeat(64),
  formatVersion: 1,
  ...overrides,
});

beforeEach(() => fakeAttachments.reset());

describe('parsePickResult', () => {
  test('reads imported files, failures and skipped count', () => {
    const result = parsePickResult(
      JSON.stringify({
        imported: [native()],
        failed: [{ fileName: 'movie.mp4', code: 'UNSUPPORTED_TYPE' }],
        skipped: 2,
      }),
      NOW,
    );
    expect(result).toEqual({
      imported: [{ ...native(), createdAt: NOW }],
      failed: [{ fileName: 'movie.mp4', code: 'UNSUPPORTED_TYPE' }],
      skipped: 2,
    });
  });

  test('drops malformed records instead of letting them reach storage', () => {
    const result = parsePickResult(
      JSON.stringify({
        imported: [
          native({ id: '../../etc/passwd' }),
          native({ mimeType: 'text/html' }),
          native({ sizeBytes: 26 * 1024 * 1024 }),
          native({ sha256: 'xyz' }),
          native({ fileName: '' }),
          native({ formatVersion: 0 }),
          null,
          native({ extra: 'ignored' }),
        ],
        failed: [{ code: 'SOMETHING_NEW' }],
        skipped: -1,
      }),
      NOW,
    );
    expect(result.imported).toEqual([{ ...native(), createdAt: NOW }]);
    expect(result.failed).toEqual([
      { fileName: 'File', code: 'IMPORT_FAILED' },
    ]);
    expect(result.skipped).toBe(0);
  });

  test('rejects output that is not JSON', () => {
    expect(() => parsePickResult('<html>', NOW)).toThrow(AttachmentError);
  });
});

describe('nativeAttachmentPlatform', () => {
  test('pick passes the request through and stamps createdAt', async () => {
    fakeAttachments.nextPick = { imported: [native()] };
    const result = await nativeAttachmentPlatform.pick({
      source: 'files',
      imagesOnly: false,
      maxCount: 10,
    });
    expect(fakeAttachments.picks).toEqual([
      { source: 'files', imagesOnly: false, maxCount: 10 },
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('pick rejections keep known codes and hide unknown ones', async () => {
    fakeAttachments.nextPick = { error: 'BUSY' };
    await expect(
      nativeAttachmentPlatform.pick({
        source: 'photos',
        imagesOnly: true,
        maxCount: 1,
      }),
    ).rejects.toMatchObject({ name: 'AttachmentError', code: 'BUSY' });

    fakeAttachments.nextPick = { error: 'WHATEVER' };
    await expect(
      nativeAttachmentPlatform.pick({
        source: 'photos',
        imagesOnly: true,
        maxCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  test('deleteFiles skips the native call for nothing', async () => {
    fakeAttachments.files.add(ID);
    await nativeAttachmentPlatform.deleteFiles([]);
    expect(fakeAttachments.deleted).toEqual([]);
    await nativeAttachmentPlatform.deleteFiles([ID]);
    expect(fakeAttachments.files.has(ID)).toBe(false);

    fakeAttachments.failNextDelete = true;
    await expect(
      nativeAttachmentPlatform.deleteFiles([ID]),
    ).rejects.toMatchObject({ code: 'IO_FAILED' });
  });
});
