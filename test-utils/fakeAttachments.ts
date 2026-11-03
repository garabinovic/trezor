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
  /** Open view URIs → attachment id. */
  views: new Map<string, string>(),
  viewCount: 0,
  /** Make openView / openPdf reject with this code for these ids. */
  viewErrors: new Map<string, string>(),
  /** Page sizes per PDF id; one A4 page by default. */
  pdfPages: new Map<string, number[][]>(),
  /** Open PDF handles → attachment id. */
  pdfs: new Map<string, string>(),
  /** Rendered page URIs → PDF handle. */
  pageViews: new Map<string, string>(),
  renders: [] as { index: number; widthPx: number }[],
  /** Page indexes whose rendering fails. */
  failingPages: new Set<number>(),
  purges: 0,
  /** Every URI passed to closeView. */
  closed: [] as string[],
  /** Save a copy / share requests, with what was passed. */
  exports: [] as { id: string; fileName: string; mimeType: string }[],
  shares: [] as { id: string; fileName: string; mimeType: string }[],
  /** What the next Save a copy does: the user saves, cancels, or it fails. */
  nextExport: 'saved' as 'saved' | 'cancelled' | { error: string },
  /** Make the next share fail with this code. */
  nextShareError: null as string | null,
  sharePurges: 0,
  nextPick: null as NextPick | null,
  failNextDelete: false,
  failNextGc: false,

  reset() {
    this.files = new Set();
    this.picks = [];
    this.deleted = [];
    this.gcRuns = [];
    this.views = new Map();
    this.viewCount = 0;
    this.viewErrors = new Map();
    this.pdfPages = new Map();
    this.pdfs = new Map();
    this.pageViews = new Map();
    this.renders = [];
    this.failingPages = new Set();
    this.purges = 0;
    this.closed = [];
    this.exports = [];
    this.shares = [];
    this.nextExport = 'saved';
    this.nextShareError = null;
    this.sharePurges = 0;
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
    async openView(id: string, _sizeBytes: number, _sha256: string) {
      const error =
        fakeAttachments.viewErrors.get(id) ??
        (fakeAttachments.files.has(id) ? null : 'MISSING');
      if (error) {
        throw Object.assign(new Error('view failed'), { code: error });
      }
      const uri = `file:///cache/attachments/view/${id}-${++fakeAttachments.viewCount}.view`;
      fakeAttachments.views.set(uri, id);
      return uri;
    },
    async closeView(uri: string) {
      fakeAttachments.closed.push(uri);
      fakeAttachments.views.delete(uri);
      fakeAttachments.pageViews.delete(uri);
      // Like native: any file in the view directory (already gone is fine).
      if (!uri.startsWith('file:///cache/attachments/view/')) {
        throw Object.assign(new Error('not a view'), {
          code: 'INVALID_ARGUMENT',
        });
      }
    },
    async openPdf(id: string, _sizeBytes: number, _sha256: string) {
      const error =
        fakeAttachments.viewErrors.get(id) ??
        (fakeAttachments.files.has(id) ? null : 'MISSING');
      if (error) {
        throw Object.assign(new Error('pdf failed'), { code: error });
      }
      const handle = `pdf-${++fakeAttachments.viewCount}`;
      fakeAttachments.pdfs.set(handle, id);
      return JSON.stringify({
        handle,
        pages: fakeAttachments.pdfPages.get(id) ?? [[595, 842]],
      });
    },
    async renderPdfPage(handle: string, index: number, widthPx: number) {
      if (!fakeAttachments.pdfs.has(handle)) {
        throw Object.assign(new Error('closed'), { code: 'INVALID_ARGUMENT' });
      }
      if (fakeAttachments.failingPages.has(index)) {
        throw Object.assign(new Error('page'), { code: 'PDF_UNSUPPORTED' });
      }
      fakeAttachments.renders.push({ index, widthPx });
      const uri = `file:///cache/attachments/view/${handle}-p${index}-${++fakeAttachments.viewCount}.view`;
      fakeAttachments.pageViews.set(uri, handle);
      return uri;
    },
    async closePdf(handle: string) {
      fakeAttachments.pdfs.delete(handle);
      for (const [uri, owner] of [...fakeAttachments.pageViews]) {
        if (owner === handle) {
          fakeAttachments.pageViews.delete(uri);
        }
      }
    },
    async saveCopy(
      id: string,
      _sizeBytes: number,
      _sha256: string,
      fileName: string,
      mimeType: string,
    ) {
      // Like native: the attachment is checked before the picker opens.
      const error =
        fakeAttachments.viewErrors.get(id) ??
        (fakeAttachments.files.has(id) ? null : 'MISSING');
      if (error) {
        throw Object.assign(new Error('export failed'), { code: error });
      }
      fakeAttachments.exports.push({ id, fileName, mimeType });
      const next = fakeAttachments.nextExport;
      fakeAttachments.nextExport = 'saved';
      if (typeof next === 'object') {
        throw Object.assign(new Error('export failed'), { code: next.error });
      }
      return next;
    },
    async share(
      id: string,
      _sizeBytes: number,
      _sha256: string,
      fileName: string,
      mimeType: string,
    ) {
      const error =
        fakeAttachments.viewErrors.get(id) ??
        (fakeAttachments.files.has(id) ? null : 'MISSING') ??
        fakeAttachments.nextShareError;
      fakeAttachments.nextShareError = null;
      if (error) {
        throw Object.assign(new Error('share failed'), { code: error });
      }
      fakeAttachments.shares.push({ id, fileName, mimeType });
    },
    async purgeExpiredShares() {
      fakeAttachments.sharePurges++;
      return 0;
    },
    async purgeInactiveViews() {
      fakeAttachments.purges++;
      return 0;
    },
    async collectGarbage(knownIds: string[]) {
      fakeAttachments.views.clear();
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
