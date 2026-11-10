import React, { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
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

const NOT_AVAILABLE = 'Not available yet';

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
          footer="Trezor stores everything on this device. There is no account and no cloud sync. A backup is a file you keep yourself, encrypted with its own password."
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
            subtitle={NOT_AVAILABLE}
            disabled
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { gap: spacing.xxxl, paddingTop: spacing.sm },
});
