import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBackup } from '../backup/backup';
import { BarHeader, Button, Screen, Text } from '../components';
import { useItems } from '../data';
import { RootStackParamList } from '../navigation/types';
import { useStorage } from '../storage/StorageProvider';
import { backupErrorMessage } from './backup/messages';
import { Busy, PasswordField, styles } from './backup/parts';

type Props = NativeStackScreenProps<RootStackParamList, 'Backup'>;

type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'running' }
  | { kind: 'done'; bytes: number };

/** `Trezor backup 2026-11-10.tzbk`, in local time. */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Trezor backup ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}.tzbk`;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Back up to a file (spec v2.4 §6): a password entered twice, an empty
 * destination chosen in the system picker, then a blocking screen while the
 * backup is written, read back and checked. Success is shown only after that
 * check (§6.2 step 7).
 */
export function BackupScreen({ navigation }: Props) {
  const { state } = useStorage();
  const { items } = useItems();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const running = phase.kind === 'running';

  // No navigation while the backup gate may be held (§6.1).
  usePreventRemove(running, () => undefined);

  const start = async () => {
    if (state.status !== 'ready') {
      return;
    }
    setPhase({ kind: 'running' });
    try {
      const result = await createBackup({
        database: state.storage.database,
        password,
        confirmation,
        suggestedName: backupFileName(),
      });
      if (result.status === 'cancelled') {
        setPhase({ kind: 'form' });
        return;
      }
      setPassword('');
      setConfirmation('');
      setPhase({ kind: 'done', bytes: result.bytes });
    } catch (e) {
      setPhase({ kind: 'form', error: backupErrorMessage(e, items) });
    }
  };

  return (
    <Screen
      header={
        <BarHeader
          title="Back up"
          onBack={running ? undefined : navigation.goBack}
        />
      }
      keyboardAware
    >
      <View style={styles.body}>
        {phase.kind === 'running' && (
          <Busy
            title="Backing up…"
            message="Your data is being written and then checked. Keep Trezor open until this is done."
          />
        )}
        {phase.kind === 'done' && (
          <View style={styles.form}>
            <Text variant="headline">Backup saved and verified</Text>
            <Text variant="callout" color="textSecondary">
              {`The backup file (${formatSize(
                phase.bytes,
              )}) was read back and checked. Keep it somewhere safe, together with its password: without the password it can’t be restored.`}
            </Text>
            <Button label="Done" onPress={navigation.goBack} />
          </View>
        )}
        {phase.kind === 'form' && (
          <View style={styles.form}>
            <Text variant="callout" color="textSecondary">
              The backup file contains all your notes, reminders, cards,
              documents and attached files, encrypted with the password you
              choose here. Trezor can’t recover a forgotten password.
            </Text>
            <PasswordField
              label="Backup password"
              value={password}
              onChangeText={setPassword}
              helper="10 to 256 characters."
            />
            <PasswordField
              label="Repeat password"
              value={confirmation}
              onChangeText={setConfirmation}
            />
            {!!phase.error && (
              <Text variant="callout" color="danger">
                {phase.error}
              </Text>
            )}
            <Button
              label="Choose where to save"
              onPress={start}
              disabled={password.length === 0 || confirmation.length === 0}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}
