import { DeviceEventEmitter } from 'react-native';
import NativeTrezorReminders from '../native/NativeTrezorReminders';
import type { RecurrenceMode } from './recurrence';

/** One reminder as the native scheduler needs it. */
export interface ScheduleEntry {
  id: string;
  mode: RecurrenceMode;
  /** UTC ms. ONCE: the moment; INTERVAL: the anchor. */
  startAt: number;
  /** Floating local "YYYY-MM-DDTHH:MM" for calendar modes. */
  localStart: string;
  intervalMinutes: number | null;
  /** Present only when reminder details may be shown. */
  title: string | null;
  body: string | null;
}

/** Android notification system, as seen by the app. Faked in tests. */
export interface ReminderPlatform {
  sync(entries: ScheduleEntry[], showDetails: boolean): Promise<void>;
  getFiredOnceIds(): Promise<string[]>;
  consumePendingTap(): string | null;
  /** Called when a notification is tapped while the app is running. */
  onTap(listener: () => void): () => void;
  notificationsEnabled(): Promise<boolean>;
  /** Reminders can be delivered on time (exact alarms allowed). */
  exactAlarmsAllowed(): Promise<boolean>;
  openExactAlarmSettings(): Promise<boolean>;
}

export const TAP_EVENT = 'trezorReminderTap';

export const nativeReminderPlatform: ReminderPlatform = {
  sync: (entries, showDetails) =>
    NativeTrezorReminders.sync(JSON.stringify(entries), showDetails),
  getFiredOnceIds: () => NativeTrezorReminders.getFiredOnceIds(),
  consumePendingTap: () => NativeTrezorReminders.consumePendingTap(),
  onTap(listener) {
    const subscription = DeviceEventEmitter.addListener(TAP_EVENT, listener);
    return () => subscription.remove();
  },
  notificationsEnabled: () => NativeTrezorReminders.areNotificationsEnabled(),
  exactAlarmsAllowed: () => NativeTrezorReminders.canScheduleExactAlarms(),
  openExactAlarmSettings: () => NativeTrezorReminders.openExactAlarmSettings(),
};
