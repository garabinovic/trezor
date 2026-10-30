/**
 * Every way opening or using storage can fail. Shown to the user via the
 * startup error screen; never triggers automatic deletion or recreation.
 */
export type StorageErrorCode =
  // Key vault (mirrors VaultException.Code in Kotlin)
  | 'KEY_NOT_FOUND'
  | 'KEY_ALREADY_EXISTS'
  | 'MASTER_KEY_MISSING'
  | 'KEY_INVALIDATED'
  | 'UNWRAP_FAILED'
  | 'ENVELOPE_UNSUPPORTED'
  | 'KEYSTORE_UNAVAILABLE'
  | 'STORAGE_ERROR'
  | 'INVALID_ARGUMENT'
  // Database
  | 'KEY_MISSING_FOR_DATABASE'
  | 'DATABASE_UNREADABLE'
  | 'DATABASE_CORRUPT'
  | 'NEWER_SCHEMA'
  | 'MIGRATION_FAILED'
  | 'WRITE_FAILED'
  | 'UNKNOWN';

const knownCodes = new Set<string>([
  'KEY_NOT_FOUND',
  'KEY_ALREADY_EXISTS',
  'MASTER_KEY_MISSING',
  'KEY_INVALIDATED',
  'UNWRAP_FAILED',
  'ENVELOPE_UNSUPPORTED',
  'KEYSTORE_UNAVAILABLE',
  'STORAGE_ERROR',
  'INVALID_ARGUMENT',
  'KEY_MISSING_FOR_DATABASE',
  'DATABASE_UNREADABLE',
  'DATABASE_CORRUPT',
  'NEWER_SCHEMA',
  'MIGRATION_FAILED',
  'WRITE_FAILED',
  'UNKNOWN',
]);

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Normalises anything thrown (native rejections included) into a StorageError. */
export function toStorageError(
  error: unknown,
  fallback: StorageErrorCode = 'UNKNOWN',
): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  const message =
    error instanceof Error ? error.message : 'Unexpected storage error';
  return new StorageError(
    typeof code === 'string' && knownCodes.has(code)
      ? (code as StorageErrorCode)
      : fallback,
    message,
  );
}
