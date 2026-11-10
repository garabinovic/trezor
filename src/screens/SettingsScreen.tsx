import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, Switch, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AlarmClockOff,
  Bell,
  BellOff,
  Download,
  FileCheck,
  FlaskConical,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react-native';
import {
  BarHeader,
  ChipGroup,
  ChipOption,
  Dialog,
  ListItem,
  Screen,
  Section,
  ValueRow,
} from '../components';
import { useItems } from '../data';
import { authErrorMessage } from '../lock/appLock';
import { useAppLock } from '../lock/AppLockProvider';
import { RootStackParamList } from '../navigation/types';
import { useReminders } from '../reminders/RemindersProvider';
import { deleteAllData, DeleteAllError } from '../storage/deleteAll';
import { useStorage } from '../storage/StorageProvider';
import { Busy } from './backup/parts';
import {
  spacing,
  ThemePreference,
  useTheme,
  useThemePreference,
} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const themeOptions: ChipOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsScreen({ navigation }: Props) {
  const { colors, scheme } = useTheme();
  const {
    showDetails,
    setShowDetails,
    notificationsEnabled,
    exactAlarmsAllowed,
    openSystemSettings,
    openExactAlarmSettings,
    scheduleFailed,
  } = useReminders();
  const { preference, setPreference } = useThemePreference();
  const { sampleDataEnabled, setSampleDataEnabled } = useItems();
  const appLock = useAppLock();
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const lockAvailable = appLock.state.availability === 'available';

  const { state: storage } = useStorage();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  /** Set synchronously: a second confirmation never starts a second deletion. */
  const deleteStarted = useRef(false);

  const deleteEverything = async () => {
    setConfirmingDelete(false);
    if (deleteStarted.current || storage.status !== 'ready') {
      return;
    }
    deleteStarted.current = true;
    setDeleteMessage(null);
    setDeleting(true);
    try {
      // Restarts into the empty app on success; never returns then.
      await deleteAllData({
        database: storage.storage.database,
        confirmIdentity: appLock.state.enabled
          ? () => appLock.confirm('Delete all data')
          : undefined,
      });
    } catch (e) {
      const code = e instanceof DeleteAllError ? e.code : 'FAILED';
      setDeleteMessage(
        code === 'CANCELLED'
          ? null
          : code === 'RESTORE_IN_PROGRESS'
          ? 'A restore is in progress. Nothing was deleted.'
          : code === 'LOCKOUT'
          ? authErrorMessage(e)
          : 'Nothing was deleted. Try again.',
      );
      setDeleting(false);
      deleteStarted.current = false;
    }
  };

  const toggleAppLock = async (enabled: boolean) => {
    setLockBusy(true);
    setLockMessage(null);
    try {
      await appLock.setEnabled(enabled);
    } catch (e) {
      setLockMessage(authErrorMessage(e));
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <Screen header={<BarHeader title="Settings" onBack={navigation.goBack} />}>
      <View style={styles.sections}>
        <Section title="Appearance">
          <ChipGroup
            label="Theme"
            options={themeOptions}
            value={preference}
            onChange={setPreference}
          />
        </Section>

        <Section
          title="Notification privacy"
          grouped
          footer={
            scheduleFailed
              ? 'Reminders couldn’t be scheduled just now. Trezor will try again automatically.'
              : 'Android’s own notification and lock-screen settings always apply.'
          }
        >
          <ListItem
            icon={Bell}
            title="Show reminder details"
            subtitle="Allow reminder titles and descriptions to appear in notifications."
            subtitleLines={3}
            trailing={
              <Switch
                accessibilityLabel="Show reminder details"
                value={showDetails}
                onValueChange={setShowDetails}
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.accent,
                }}
                thumbColor={scheme === 'dark' ? colors.text : colors.surface}
              />
            }
          />
          {notificationsEnabled === false && (
            <ListItem
              icon={BellOff}
              title="Notifications are off"
              subtitle="Turn them on in Android settings to receive reminders."
              subtitleLines={2}
              chevron
              onPress={openSystemSettings}
            />
          )}
          {notificationsEnabled !== false && exactAlarmsAllowed === false && (
            <ListItem
              icon={AlarmClockOff}
              title="Reminders may be late"
              subtitle="Allow “Alarms & reminders” in Android settings so reminders arrive on time."
              subtitleLines={3}
              chevron
              onPress={openExactAlarmSettings}
            />
          )}
        </Section>

        <Section
          title="Security"
          grouped
          footer={
            lockMessage ??
            'App lock hides Trezor whenever you leave it, until you unlock it with your fingerprint, face or screen lock. Your data is encrypted either way.'
          }
        >
          <ListItem
            icon={Lock}
            title="App lock"
            subtitle={
              appLock.state.enabled || lockAvailable
                ? 'Ask for your fingerprint, face or screen lock'
                : 'Set up a screen lock in Android settings first'
            }
            subtitleLines={2}
            trailing={
              <Switch
                accessibilityLabel="App lock"
                value={appLock.state.enabled}
                onValueChange={toggleAppLock}
                disabled={
                  lockBusy || (!appLock.state.enabled && !lockAvailable)
                }
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.accent,
                }}
                thumbColor={scheme === 'dark' ? colors.text : colors.surface}
              />
            }
          />
        </Section>

        <Section
          title="Data"
          grouped
          footer={
            deleteMessage ??
            'Trezor stores everything on this device. There is no account and no cloud sync. A backup is a file you keep yourself, encrypted with its own password.'
          }
        >
          <ListItem
            icon={Download}
            title="Back up to a file"
            subtitle="Everything, encrypted with a password you choose"
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('Backup')}
          />
          <ListItem
            icon={FileCheck}
            title="Check a backup"
            subtitle="Verify a backup file without changing anything"
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('CheckBackup')}
          />
          <ListItem
            icon={Upload}
            title="Restore from a backup"
            subtitle="Replaces all data on this device"
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('Restore')}
          />
          <ListItem
            icon={Trash2}
            title="Delete all data"
            subtitle="Everything on this device; backup files are kept"
            subtitleLines={2}
            onPress={() => setConfirmingDelete(true)}
          />
        </Section>

        {__DEV__ && (
          <Section
            title="Preview"
            grouped
            footer="Development builds only. Sample data is kept in memory and is never mixed with your saved items."
          >
            <ListItem
              icon={FlaskConical}
              title="Show sample data"
              subtitle="Turn off to see the first-launch experience"
              subtitleLines={2}
              trailing={
                <Switch
                  accessibilityLabel="Show sample data"
                  value={sampleDataEnabled}
                  onValueChange={setSampleDataEnabled}
                  trackColor={{
                    false: colors.borderStrong,
                    true: colors.accent,
                  }}
                  thumbColor={scheme === 'dark' ? colors.text : colors.surface}
                />
              }
            />
          </Section>
        )}

        <Section title="About" grouped>
          <ValueRow label="Version" value="0.1.0 (preview)" />
          <ListItem
            icon={ShieldCheck}
            title="Private by design"
            subtitle="No ads, no tracking and no account. Your data never leaves this device."
            subtitleLines={3}
          />
        </Section>
      </View>
      <Dialog
        visible={confirmingDelete}
        title="Delete all data?"
        message="All notes, reminders, cards, documents and attached files on this device are permanently deleted, and Trezor starts empty. Backup files you saved outside Trezor are not affected. This can’t be undone."
        confirmLabel="Delete everything"
        destructive
        secondaryLabel="Back up first"
        onSecondary={() => {
          setConfirmingDelete(false);
          navigation.navigate('Backup');
        }}
        onConfirm={deleteEverything}
        onCancel={() => setConfirmingDelete(false)}
      />
      <Modal
        visible={deleting}
        animationType="fade"
        statusBarTranslucent
        // Back does nothing while deleting.
        onRequestClose={() => undefined}
      >
        <View style={[styles.deleting, { backgroundColor: colors.background }]}>
          <Busy title="Deleting…" />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { gap: spacing.xxxl, paddingTop: spacing.sm },
  deleting: { flex: 1, justifyContent: 'center' },
});
