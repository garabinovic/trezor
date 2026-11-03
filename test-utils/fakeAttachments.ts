// Test-only stand-in for the TrezorAttachments native module (installed in
// jest.setup.js). Keeps the set of "stored" attachment files in memory.

interface NextPick {
  imported?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    formatVersion: number;
  }[];
  failed?: { fileName: string; code: string }[];
  skipped?: number;
  /** Reject with this code instead. */
  error?: string;
}

export const fakeAttachments = {
  /** Ids that have an encrypted file. */
  files: new Set<string>(),
  picks: [] as { source: string; imagesOnly: boolean; maxCount: number }[],
  deleted: [] as string[],
  gcRuns: [] as string[][],
  nextPick: null as NextPick | null,
  failNextDelete: false,
  failNextGc: false,

  reset() {
    this.files = new Set();
    this.picks = [];
    this.deleted = [];
    this.gcRuns = [];
    this.nextPick = null;
    this.failNextDelete = false;
    this.failNextGc = false;
  },

  /** The module object the app sees (same shape as NativeTrezorAttachments). */
  module: {
    async pick(source: string, imagesOnly: boolean, maxCount: number) {
      fakeAttachments.picks.push({ source, imagesOnly, maxCount });
      const next = fakeAttachments.nextPick ?? {};
      fakeAttachments.nextPick = null;
      if (next.error) {
        throw Object.assign(new Error('pick failed'), { code: next.error });
      }
      const imported = next.imported ?? [];
      imported.forEach(a => fakeAttachments.files.add(a.id));
      return JSON.stringify({
        imported,
        failed: next.failed ?? [],
        skipped: next.skipped ?? 0,
      });
    },
    async deleteFiles(ids: string[]) {
      if (fakeAttachments.failNextDelete) {
        fakeAttachments.failNextDelete = false;
        throw Object.assign(new Error('failed'), { code: 'IO_FAILED' });
      }
      let removed = 0;
      for (const id of ids) {
        fakeAttachments.deleted.push(id);
        if (fakeAttachments.files.delete(id)) {
          removed++;
        }
      }
      return removed;
    },
    async collectGarbage(knownIds: string[]) {
      if (fakeAttachments.failNextGc) {
        fakeAttachments.failNextGc = false;
        throw Object.assign(new Error('failed'), { code: 'IO_FAILED' });
      }
      fakeAttachments.gcRuns.push([...knownIds]);
      const known = new Set(knownIds);
      let removed = 0;
      for (const id of [...fakeAttachments.files]) {
        if (!known.has(id)) {
          fakeAttachments.files.delete(id);
          removed++;
        }
      }
      return removed;
    },
  },
};
