import NativeTrezorRestore from '../native/NativeTrezorRestore';
import type { ArtifactAttachment } from './platform';

/**
 * Why a restore preparation stopped (Phase 6 spec v2.4 §8). The restore codes
 * are the spec's; backup-file and password codes come from the restore pass
 * reading the file. `RESTORE_IN_PROGRESS` (attachment work refused under the
 * gate), `RESTORE_CANCELLED` (cancelled while a share was active) and
 * `RESTORE_FAILED` (anything else) are this implementation's.
 */
export class RestoreError extends Error {
  constructor(
    readonly code: string,
    /**
     * False only when the pre-swap failure path itself failed: the journal and
     * staging files are kept (`RESTORE_RECOVERY_RETRY`), for Step 4's recovery.
     */
    readonly cleanedUp: boolean = true,
  ) {
    super(code);
    this.name = 'RestoreError';
  }

  static from(e: unknown, cleanedUp = true): RestoreError {
    if (e instanceof RestoreError) {
      return cleanedUp ? e : new RestoreError(e.code, false);
    }
    const code = (e as { code?: unknown } | null)?.code;
    return new RestoreError(
      typeof code === 'string' && /^[A-Z_]+$/.test(code)
        ? code
        : 'RESTORE_FAILED',
      cleanedUp,
    );
  }
}

export type Preflight =
  | { status: 'ready' }
  | { status: 'notOffered' }
  | { status: 'refused'; code: string };

export interface RestoreBegun {
  sessionId: string;
  backupId: string;
  attachments: number;
  databaseBytes: number;
}

export interface RestoreStaged {
  restoreId: string;
  backupId: string;
  trailer: string;
  /** Absolute `D/restore`. */
  location: string;
  /** `incoming.db` (artifact key) and `trezor.db` (`S_db`, device key). */
  incoming: string;
  staged: string;
  /** The SQLCipher artifact key (hex), for `incoming` only. */
  key: string;
  schemaVersion: number;
  attachments: ArtifactAttachment[];
}

export interface RetainedOutcome {
  linked: number;
  copied: number;
  missing: number;
  failClosed: boolean;
}

/** The native half (TrezorRestoreModule). Replaceable in tests. */
export interface RestorePlatform {
  preflight(fromErrorScreen: boolean): Promise<Preflight>;
  beginRestore(uri: string, password: string): Promise<RestoreBegun>;
  acquireGate(): Promise<void>;
  activeShareCount(): Promise<number>;
  stageRestore(
    sessionId: string,
    expected?: { backupId: string; trailer: string },
  ): Promise<RestoreStaged>;
  deleteIncoming(sessionId: string): Promise<void>;
  preserveRetained(sessionId: string): Promise<RetainedOutcome>;
  saveAndClearSchedule(sessionId: string): Promise<'saved' | 'absent'>;
  purgeCaches(): Promise<void>;
  abortRestore(sessionId: string): Promise<void>;
  releaseGate(): Promise<void>;
}

const json = async <T>(text: Promise<string>): Promise<T> =>
  JSON.parse(await text) as T;

export const nativeRestorePlatform: RestorePlatform = {
  preflight: fromErrorScreen =>
    json(NativeTrezorRestore.preflight(fromErrorScreen)),
  beginRestore: (uri, password) =>
    json(NativeTrezorRestore.beginRestore(uri, password)),
  acquireGate: () => NativeTrezorRestore.acquireGate(),
  activeShareCount: () => NativeTrezorRestore.activeShareCount(),
  stageRestore: (sessionId, expected) =>
    json(
      NativeTrezorRestore.stageRestore(
        sessionId,
        expected?.backupId ?? '',
        expected?.trailer ?? '',
      ),
    ),
  deleteIncoming: sessionId => NativeTrezorRestore.deleteIncoming(sessionId),
  preserveRetained: sessionId =>
    json(NativeTrezorRestore.preserveRetained(sessionId)),
  saveAndClearSchedule: async sessionId =>
    (await NativeTrezorRestore.saveAndClearSchedule(sessionId)) === 'saved'
      ? 'saved'
      : 'absent',
  purgeCaches: () => NativeTrezorRestore.purgeCaches(),
  abortRestore: sessionId => NativeTrezorRestore.abortRestore(sessionId),
  releaseGate: () => NativeTrezorRestore.releaseGate(),
};
