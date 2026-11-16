import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBackup } from '../backup/backup';
import { BarHeader, Button, Screen, Text } from '../components';
import { useItems } from '../data';
import { useStrings } from '../i18n';
import { strings } from '../i18n/strings';
import { RootStackParamList } from '../navigation/types';
import { useStorage } from '../storage/StorageProvider';
import { backupErrorMessage } from './backup/messages';
import { Busy, PasswordField, styles } from './backup/parts';

type Props = NativeStackScreenProps<RootStackParamList, 'Backup'>;

type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'running' }
  | { kind: 'done'; bytes: number };

/** `Trezor backup 2026-11-10.tzbk` (in the app language), in local time. */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return strings().backup.fileName(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  );
}

function formatSize(bytes: number): string {
  const t = strings().numbers;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', t.decimal)} ${t.mb}`
    : `${Math.max(1, Math.round(bytes / 1024))} ${t.kb}`;
}

/**
 * Back up to a file (spec v2.4 §6): a password entered twice, an empty
 * destination chosen in the system picker, then a blocking screen while the
 * backup is written, read back and checked. Success is shown only after that
 * check (§6.2 step 7).
 */
export function BackupScreen({ navigation }: Props) {
  const { state } = useStorage();
  const t = useStrings();
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
          title={t.backup.title}
          onBack={running ? undefined : navigation.goBack}
        />
      }
      keyboardAware
      footer={
        phase.kind === 'done' ? (
          <Button label={t.common.done} onPress={navigation.goBack} fullWidth />
        ) : phase.kind === 'form' ? (
          <Button
            label={t.backup.chooseDestination}
            onPress={start}
            disabled={password.length === 0 || confirmation.length === 0}
            fullWidth
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        {phase.kind === 'running' && (
          <Busy title={t.backup.running} message={t.backup.runningMessage} />
        )}
        {phase.kind === 'done' && (
          <View style={styles.form}>
            <Text variant="headline">{t.backup.savedTitle}</Text>
            <Text variant="callout" color="textSecondary">
              {t.backup.savedMessage(formatSize(phase.bytes))}
            </Text>
          </View>
        )}
        {phase.kind === 'form' && (
          <View style={styles.form}>
            <Text variant="callout" color="textSecondary">
              {t.backup.intro}
            </Text>
            <PasswordField
              label={t.backup.password}
              value={password}
              onChangeText={setPassword}
              helper={t.backup.passwordHelper}
            />
            <PasswordField
              label={t.backup.repeatPassword}
              value={confirmation}
              onChangeText={setConfirmation}
            />
            {!!phase.error && (
              <Text variant="callout" color="danger">
                {phase.error}
              </Text>
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}
