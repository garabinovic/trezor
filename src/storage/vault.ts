import NativeTrezorVault from '../native/NativeTrezorVault';
import { toStorageError } from './errors';

export type KeyId = 'database';

export type MasterKeySecurityLevel =
  | 'strongbox'
  | 'tee'
  | 'software'
  | 'unknown'
  | 'none';

/**
 * Android Keystore key vault. Returned keys are hex strings: hand them straight
 * to the consumer and drop the reference. Never log them.
 */
export const vault = {
  async hasKey(keyId: KeyId): Promise<boolean> {
    try {
      return await NativeTrezorVault.hasKey(keyId);
    } catch (e) {
      throw toStorageError(e, 'KEYSTORE_UNAVAILABLE');
    }
  },

  async createKey(keyId: KeyId): Promise<string> {
    try {
      return await NativeTrezorVault.createKey(keyId);
    } catch (e) {
      throw toStorageError(e, 'KEYSTORE_UNAVAILABLE');
    }
  },

  async getKey(keyId: KeyId): Promise<string> {
    try {
      return await NativeTrezorVault.getKey(keyId);
    } catch (e) {
      throw toStorageError(e, 'KEYSTORE_UNAVAILABLE');
    }
  },

  /** Synchronous; backed by java.security.SecureRandom. */
  randomBytes(length: number): Uint8Array {
    const hex = NativeTrezorVault.randomBytesHex(length);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  },

  async masterKeySecurityLevel(): Promise<MasterKeySecurityLevel> {
    return (await NativeTrezorVault.getMasterKeySecurityLevel()) as MasterKeySecurityLevel;
  },
};
