import React, { useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AlarmClockOff,
  Bell,
  BellOff,
  Check,
  Download,
  FileCheck,
  FlaskConical,
  Lock,
  Trash2,
  Upload,
} from 'lucide-react-native';
import {
  BarHeader,
  ChipGroup,
  Dialog,
  Icon,
  ListItem,
  Screen,
  Section,
  Text,
  ValueRow,
} from '../components';
import { useItems } from '../data';
import { LANGUAGES, languageNames, useLanguage, useStrings } from '../i18n';
import NativeTrezorBackup from '../native/NativeTrezorBackup';
import { authErrorMessage } from '../lock/appLock';
import { useAppLock } from '../lock/AppLockProvider';
import { RootStackParamList } from '../navigation/types';
import { useReminders } from '../reminders/RemindersProvider';
import { deleteAllData, DeleteAllError } from '../storage/deleteAll';
import { useStorage } from '../storage/StorageProvider';
import { Busy } from './backup/parts';
import {
  gutter,
  minTouchTarget,
  spacing,
  ThemePreference,
  useTheme,
  useThemePreference,
} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

/** The installed build's version (Android versionName and versionCode). */
function appVersion(): string {
  const { versionName, versionCode } = JSON.parse(
    NativeTrezorBackup.appVersion(),
  ) as { versionName: string; versionCode: number };
  return `${versionName} (${versionCode})`;
}

const FEEDBACK_EMAIL = 'andrijag@gmail.com';

function AboutTrezor() {
  const t = useStrings().settings;
  return (
    <View style={styles.about}>
      <Text variant="headline" accessibilityRole="header">
        {t.aboutTitle}
      </Text>
      {t.aboutParagraphs.map(paragraph => (
        <Text key={paragraph} variant="callout" color="textSecondary">
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

/** Opens the default email app (a `mailto:` link; no SDK, no network). */
function Feedback() {
  const t = useStrings().settings;
  const [noEmailApp, setNoEmailApp] = useState(false);
  const write = () =>
    Linking.openURL(`mailto:${FEEDBACK_EMAIL}`).then(
      () => setNoEmailApp(false),
      () => setNoEmailApp(true),
    );
  return (
    <View style={styles.about}>
      <Text variant="headline" accessibilityRole="header">
        {t.feedbackTitle}
      </Text>
      {t.feedbackParagraphs.map(paragraph => (
        <Text key={paragraph} variant="callout" color="textSecondary">
          {paragraph}
        </Text>
      ))}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t.emailAccessibility(FEEDBACK_EMAIL)}
        onPress={write}
        style={styles.emailRow}
      >
        <Text variant="callout" color="textSecondary">
          {t.email}
          <Text variant="callout" color="accent">
            {FEEDBACK_EMAIL}
          </Text>
        </Text>
      </Pressable>
      {noEmailApp && (
        <Text variant="caption" color="textTertiary">
          {t.noEmailApp}
        </Text>
      )}
    </View>
  );
}

/** Settings → Language: each language under its own name; applies at once. */
function LanguageChoice() {
  const { language, setLanguage } = useLanguage();
  const t = useStrings().settings;
  return (
    <Section title={t.language} grouped>
      {LANGUAGES.map(code => (
        <ListItem
          key={code}
          title={languageNames[code]}
          selected={code === language}
          trailing={
            code === language ? (
              <Icon icon={Check} size="md" color="accent" />
            ) : undefined
          }
          onPress={() => setLanguage(code)}
        />
      ))}
    </Section>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const { colors, scheme } = useTheme();
  const all = useStrings();
  const t = all.settings;
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
  const [version] = useState(appVersion);
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
          ? () => appLock.confirm(all.lock.confirmDeleteAll)
          : undefined,
      });
    } catch (e) {
      const code = e instanceof DeleteAllError ? e.code : 'FAILED';
      setDeleteMessage(
        code === 'CANCELLED'
          ? null
          : code === 'RESTORE_IN_PROGRESS'
          ? t.deleteRestoreInProgress
          : code === 'LOCKOUT'
          ? authErrorMessage(e)
          : t.deleteFailed,
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
    <Screen header={<BarHeader title={t.title} onBack={navigation.goBack} />}>
      <View style={styles.sections}>
        <Section title={t.appearance}>
          <ChipGroup
            label={t.theme}
            options={THEMES.map(value => ({
              value,
              label:
                value === 'system'
                  ? t.themeSystem
                  : value === 'light'
                  ? t.themeLight
                  : t.themeDark,
            }))}
            value={preference}
            onChange={setPreference}
          />
        </Section>

        <LanguageChoice />

        <Section
          title={t.notificationPrivacy}
          grouped
          footer={scheduleFailed ? t.scheduleFailed : t.androidSettingsApply}
        >
          <ListItem
            icon={Bell}
            title={t.showDetails}
            subtitle={t.showDetailsSubtitle}
            subtitleLines={3}
            trailing={
              <Switch
                accessibilityLabel={t.showDetails}
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
              title={t.notificationsOff}
              subtitle={t.notificationsOffSubtitle}
              subtitleLines={2}
              chevron
              onPress={openSystemSettings}
            />
          )}
          {notificationsEnabled !== false && exactAlarmsAllowed === false && (
            <ListItem
              icon={AlarmClockOff}
              title={t.remindersLate}
              subtitle={t.remindersLateSubtitle}
              subtitleLines={3}
              chevron
              onPress={openExactAlarmSettings}
            />
          )}
        </Section>

        <Section
          title={t.security}
          grouped
          footer={lockMessage ?? t.appLockFooter}
        >
          <ListItem
            icon={Lock}
            title={t.appLock}
            subtitle={
              appLock.state.enabled || lockAvailable
                ? t.appLockSubtitle
                : t.appLockNeedsScreenLock
            }
            subtitleLines={2}
            trailing={
              <Switch
                accessibilityLabel={t.appLock}
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

        <Section title={t.data} grouped footer={deleteMessage ?? t.dataFooter}>
          <ListItem
            icon={Download}
            title={t.backup}
            subtitle={t.backupSubtitle}
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('Backup')}
          />
          <ListItem
            icon={FileCheck}
            title={t.checkBackup}
            subtitle={t.checkBackupSubtitle}
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('CheckBackup')}
          />
          <ListItem
            icon={Upload}
            title={t.restore}
            subtitle={t.restoreSubtitle}
            subtitleLines={2}
            chevron
            onPress={() => navigation.navigate('Restore')}
          />
          <ListItem
            icon={Trash2}
            title={t.deleteAll}
            subtitle={t.deleteAllSubtitle}
            subtitleLines={2}
            onPress={() => setConfirmingDelete(true)}
          />
        </Section>

        {__DEV__ && (
          <Section title={t.preview} grouped footer={t.previewFooter}>
            <ListItem
              icon={FlaskConical}
              title={t.sampleData}
              subtitle={t.sampleDataSubtitle}
              subtitleLines={2}
              trailing={
                <Switch
                  accessibilityLabel={t.sampleData}
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

        <Section title={t.about} grouped>
          <ValueRow label={t.version} value={version} />
          <AboutTrezor />
          <Feedback />
        </Section>
      </View>
      <Dialog
        visible={confirmingDelete}
        title={t.deleteAllTitle}
        message={t.deleteAllMessage}
        confirmLabel={t.deleteEverything}
        destructive
        confirmApart
        secondaryLabel={t.backUpFirst}
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
          <Busy title={t.deleting} />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { gap: spacing.xxxl, paddingTop: spacing.sm },
  deleting: { flex: 1, justifyContent: 'center' },
  about: {
    gap: spacing.sm,
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
  },
  emailRow: { minHeight: minTouchTarget, justifyContent: 'center' },
});
