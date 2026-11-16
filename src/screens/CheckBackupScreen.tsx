import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { checkBackup } from '../backup/backup';
import { BarHeader, Button, Screen, Text } from '../components';
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { backupErrorMessage } from './backup/messages';
import { Busy, PasswordField, styles } from './backup/parts';

type Props = NativeStackScreenProps<RootStackParamList, 'CheckBackup'>;

type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'running' }
  | { kind: 'valid'; attachments: number };

/**
 * Check a backup (spec v2.4 §7): reads a backup file completely and verifies
 * everything in it with its password. Nothing on this device is changed.
 */
export function CheckBackupScreen({ navigation }: Props) {
  const t = useStrings();
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const running = phase.kind === 'running';

  usePreventRemove(running, () => undefined);

  const start = async () => {
    setPhase({ kind: 'running' });
    try {
      const result = await checkBackup({ password });
      if (result.status === 'cancelled') {
        setPhase({ kind: 'form' });
        return;
      }
      setPassword('');
      setPhase({ kind: 'valid', attachments: result.attachments });
    } catch (e) {
      setPhase({ kind: 'form', error: backupErrorMessage(e, []) });
    }
  };

  return (
    <Screen
      header={
        <BarHeader
          title={t.check.title}
          onBack={running ? undefined : navigation.goBack}
        />
      }
      keyboardAware
      footer={
        phase.kind === 'valid' ? (
          <Button label={t.common.done} onPress={navigation.goBack} fullWidth />
        ) : phase.kind === 'form' ? (
          <Button
            label={t.check.chooseFile}
            onPress={start}
            disabled={password.length === 0}
            fullWidth
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        {phase.kind === 'running' && <Busy title={t.check.running} />}
        {phase.kind === 'valid' && (
          <View style={styles.form}>
            <Text variant="headline">{t.check.validTitle}</Text>
            <Text variant="callout" color="textSecondary">
              {t.check.validMessage(phase.attachments)}
            </Text>
          </View>
        )}
        {phase.kind === 'form' && (
          <View style={styles.form}>
            <Text variant="callout" color="textSecondary">
              {t.check.intro}
            </Text>
            <PasswordField
              label={t.backup.password}
              value={password}
              onChangeText={setPassword}
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
