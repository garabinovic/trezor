// Test-only stand-in for the TrezorReminders native module (installed in
// jest.setup.js). Records what the app asked Android to schedule.
import type { ScheduleEntry } from '../src/reminders/platform';

export const fakeReminders = {
  entries: [] as ScheduleEntry[],
  showDetails: false,
  syncCalls: 0,
  fired: [] as string[],
  pendingTap: null as string | null,
  enabled: true,
  failNextSync: false,

  reset() {
    this.entries = [];
    this.showDetails = false;
    this.syncCalls = 0;
    this.fired = [];
    this.pendingTap = null;
    this.enabled = true;
    this.failNextSync = false;
  },

  /** The module object the app sees (same shape as NativeTrezorReminders). */
  module: {
    async sync(entriesJson: string, showDetails: boolean) {
      if (fakeReminders.failNextSync) {
        fakeReminders.failNextSync = false;
        throw Object.assign(new Error('failed'), { code: 'SCHEDULE_FAILED' });
      }
      const entries = JSON.parse(entriesJson) as ScheduleEntry[];
      fakeReminders.syncCalls++;
      fakeReminders.entries = entries;
      fakeReminders.showDetails = showDetails;
      // Like the native side: "fired" only survives for ONCE ids still present.
      const ids = new Set(
        entries.filter(e => e.mode === 'once').map(e => e.id),
      );
      fakeReminders.fired = fakeReminders.fired.filter(id => ids.has(id));
    },
    async getFiredOnceIds() {
      return [...fakeReminders.fired];
    },
    consumePendingTap() {
      const id = fakeReminders.pendingTap;
      fakeReminders.pendingTap = null;
      return id;
    },
    async areNotificationsEnabled() {
      return fakeReminders.enabled;
    },
  },
};
