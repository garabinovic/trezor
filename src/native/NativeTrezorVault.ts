import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Android Keystore-backed key vault (android/app/src/main/java/com/trezor/app/vault).
 *
 * Errors reject with one of the `VaultErrorCode` codes in src/storage/vault.ts.
 * Key material is returned as lowercase hex and must never be logged.
 */
export interface Spec extends TurboModule {
  /** Whether a wrapped key envelope exists for `keyId`. */
  hasKey(keyId: string): Promise<boolean>;
  /** Creates a new random 256-bit key. Rejects if one already exists. */
  createKey(keyId: string): Promise<string>;
  /** Unwraps an existing key. Never creates one. */
  getKey(keyId: string): Promise<string>;
  /** Cryptographically secure random bytes (SecureRandom), as hex. */
  randomBytesHex(length: number): string;
  /** Where the master key lives: 'strongbox' | 'tee' | 'software' | 'unknown' | 'none'. */
  getMasterKeySecurityLevel(): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorVault');
