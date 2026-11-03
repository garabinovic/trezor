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
      rejectedIds: [],
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
    // Every refused record is reported, then the native failures.
    expect(result.failed).toEqual([
      ...[
        'scan.pdf',
        'scan.pdf',
        'scan.pdf',
        'scan.pdf',
        'File',
        'scan.pdf',
        'File',
      ].map(fileName => ({ fileName, code: 'IMPORT_FAILED' })),
      { fileName: 'File', code: 'IMPORT_FAILED' },
    ]);
    // All share the accepted record's id or have none: nothing may be deleted.
    expect(result.rejectedIds).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  test('only well-formed, unshared ids of refused records are returned for deletion', () => {
    const other = '01a1a0dd-991f-783c-9531-3fab9ef47902';
    const twice = '01a1a0dd-991f-783c-9531-3fab9ef47903';
    const result = parsePickResult(
      JSON.stringify({
        imported: [
          native(),
          native({ id: other, mimeType: 'text/html', fileName: 'page.html' }),
          native({ id: '../../files/attachments/x', mimeType: 'text/html' }),
          native({ id: 'ABC', fileName: 'upper.pdf', sha256: 'no' }),
          native({ id: twice, sizeBytes: -1 }),
          native({ id: twice, fileName: 'again.pdf' }),
        ],
      }),
      NOW,
    );
    expect(result.imported.map(a => a.id)).toEqual([ID, twice]);
    // `twice` is also an accepted record: never deleted.
    expect(result.rejectedIds).toEqual([other]);
    expect(result.failed.map(f => f.fileName)).toEqual([
      'page.html',
      'scan.pdf',
      'upper.pdf',
      'scan.pdf',
    ]);
  });

  test('rejects output that is not JSON', () => {
    expect(() => parsePickResult('<html>', NOW)).toThrow(AttachmentError);
  });
});

describe('nativeAttachmentPlatform', () => {
  test('pick deletes refused files at once and reports them; valid ones stay', async () => {
    const bad = '01a1a0dd-991f-783c-9531-3fab9ef47909';
    const saved = '01a1a0dd-991f-783c-9531-3fab9ef47999';
    fakeAttachments.files.add(saved); // a stored attachment of another item
    fakeAttachments.nextPick = {
      imported: [
        native(),
        native({ id: bad, mimeType: 'text/html', fileName: 'page.html' }),
        native({ id: '../../files/x', mimeType: 'text/html' }),
      ],
    };
    const result = await nativeAttachmentPlatform.pick({
      source: 'files',
      imagesOnly: false,
      maxCount: 10,
    });
    expect(result.imported.map(a => a.id)).toEqual([ID]);
    expect(result.failed).toEqual([
      { fileName: 'page.html', code: 'IMPORT_FAILED' },
      { fileName: 'scan.pdf', code: 'IMPORT_FAILED' },
    ]);
    expect(result).not.toHaveProperty('rejectedIds');
    expect(fakeAttachments.deleted).toEqual([bad]);
    expect(fakeAttachments.files.has(ID)).toBe(true);
    expect(fakeAttachments.files.has(saved)).toBe(true);
  });

  test('a failed cleanup of refused files still reports them', async () => {
    const bad = '01a1a0dd-991f-783c-9531-3fab9ef47909';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fakeAttachments.failNextDelete = true;
    fakeAttachments.nextPick = {
      imported: [
        native({ id: bad, mimeType: 'text/html', fileName: 'p.html' }),
      ],
    };
    const result = await nativeAttachmentPlatform.pick({
      source: 'files',
      imagesOnly: false,
      maxCount: 10,
    });
    expect(result.failed).toEqual([
      { fileName: 'p.html', code: 'IMPORT_FAILED' },
    ]);
    expect(result.imported).toEqual([]);
    // Left for the startup cleanup.
    expect(fakeAttachments.files.has(bad)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[attachments] could not delete rejected import files',
    );
    warn.mockRestore();
  });

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

  test('openView returns a closable copy and reports missing or damaged files', async () => {
    const record = {
      ...native(),
      mimeType: 'image/jpeg' as const,
      createdAt: NOW,
    };
    fakeAttachments.files.add(ID);
    const uri = await nativeAttachmentPlatform.openView(record);
    expect(fakeAttachments.views.get(uri)).toBe(ID);
    await nativeAttachmentPlatform.closeView(uri);
    expect(fakeAttachments.views.size).toBe(0);
    // Closing twice is harmless; paths outside the view directory are refused.
    await nativeAttachmentPlatform.closeView(uri);
    await expect(
      nativeAttachmentPlatform.closeView('file:///data/attachments/x.tza'),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    fakeAttachments.viewErrors.set(ID, 'DAMAGED');
    await expect(
      nativeAttachmentPlatform.openView(record),
    ).rejects.toMatchObject({ name: 'AttachmentError', code: 'DAMAGED' });
    fakeAttachments.files.delete(ID);
    fakeAttachments.viewErrors.clear();
    await expect(
      nativeAttachmentPlatform.openView(record),
    ).rejects.toMatchObject({ code: 'MISSING' });
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
