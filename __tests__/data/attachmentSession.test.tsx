import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type {
  AttachmentPlatform,
  PickResult,
} from '../../src/attachments/platform';
import type { Attachment } from '../../src/data/types';
import {
  AttachmentSession,
  useAttachmentSession,
} from '../../src/screens/editor/attachmentSession';

const file = (n: number): Attachment => ({
  id: `01a1a0dd-991f-783c-9531-3fab9ef479${String(n).padStart(2, '0')}`,
  fileName: `IMG_${n}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 1,
  sha256: 'a'.repeat(64),
  formatVersion: 1,
  createdAt: '2026-11-03T00:00:00.000Z',
});

function fakePlatform() {
  const deleted: string[] = [];
  let resolvePick: ((r: PickResult) => void) | null = null;
  const platform: AttachmentPlatform = {
    pick: () =>
      new Promise(resolve => {
        resolvePick = resolve;
      }),
    deleteFiles: async ids => {
      deleted.push(...ids);
    },
    openView: async () => 'file:///x',
    closeView: async () => {},
    openPdf: async () => ({ handle: 'h', pages: [] }),
    renderPdfPage: async () => 'file:///p',
    closePdf: async () => {},
    purgeInactiveViews: async () => 0,
    collectGarbage: async () => 0,
  };
  return {
    platform,
    deleted,
    finishPick: async (imported: Attachment[]) => {
      await ReactTestRenderer.act(async () => {
        resolvePick?.({ imported, failed: [], skipped: 0 });
      });
    },
  };
}

async function mount(platform: AttachmentPlatform) {
  let session!: AttachmentSession;
  function Probe() {
    session = useAttachmentSession(platform);
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Probe />);
  });
  return {
    session: () => session,
    unmount: () => ReactTestRenderer.act(async () => renderer.unmount()),
  };
}

const options = { source: 'photos', imagesOnly: true, maxCount: 1 } as const;

describe('useAttachmentSession', () => {
  test('releasing deletes only files picked in this session', async () => {
    const f = fakePlatform();
    const s = await mount(f.platform);
    const picked = s.session().pick(options);
    await f.finishPick([file(1)]);
    expect((await picked)?.imported).toEqual([file(1)]);

    s.session().release([file(1).id, file(9).id]); // 9 is a stored photo
    await Promise.resolve();
    expect(f.deleted).toEqual([file(1).id]);
  });

  test('commit keeps what the saved item uses and deletes the rest', async () => {
    const f = fakePlatform();
    const s = await mount(f.platform);
    const picked = s.session().pick({ ...options, maxCount: 2 });
    await f.finishPick([file(1), file(2)]);
    await picked;

    s.session().commit([file(2).id, file(9).id]);
    await s.unmount();
    expect(f.deleted).toEqual([file(1).id]);
  });

  test('leaving without saving deletes every picked file', async () => {
    const f = fakePlatform();
    const s = await mount(f.platform);
    const picked = s.session().pick({ ...options, maxCount: 2 });
    await f.finishPick([file(1), file(2)]);
    await picked;

    await s.unmount();
    expect(f.deleted.sort()).toEqual([file(1).id, file(2).id]);
  });

  test('a pick that finishes after the editor closed is deleted, not returned', async () => {
    const f = fakePlatform();
    const s = await mount(f.platform);
    const picked = s.session().pick(options);
    await s.unmount();
    expect(f.deleted).toEqual([]);

    await f.finishPick([file(3)]);
    expect(await picked).toBeNull();
    expect(f.deleted).toEqual([file(3).id]);
  });
});
