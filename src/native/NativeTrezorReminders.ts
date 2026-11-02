import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Android reminder scheduling (android/app/src/main/java/com/trezor/app/reminders).
 * The encrypted database is the source of truth; this keeps an operational,
 * Keystore-encrypted copy so alarms can fire while the app isn't running.
 */
export interface Spec extends TurboModule {
  /**
   * Replaces the whole native schedule with these entries (JSON array) and
   * re-arms alarms. Idempotent. Titles/descriptions must only be included
   * when `showDetails` is true.
   */
  sync(entriesJson: string, showDetails: boolean): Promise<void>;
  /** ONCE reminders that fired and still need to be marked completed. */
  getFiredOnceIds(): Promise<string[]>;
  /** Reminder id from a tapped notification, consumed on read. */
  consumePendingTap(): string | null;
  areNotificationsEnabled(): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrezorReminders');
