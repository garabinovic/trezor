import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { checkBackup } from '../backup/backup';
import { BarHeader, Button, Screen, Text } from '../components';
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
          title="Check a backup"
          onBack={running ? undefined : navigation.goBack}
        />
      }
      keyboardAware
    >
      <View style={styles.body}>
        {phase.kind === 'running' && <Busy title="Checking the backup…" />}
        {phase.kind === 'valid' && (
          <View style={styles.form}>
            <Text variant="headline">The backup is complete</Text>
            <Text variant="callout" color="textSecondary">
              {`Every part of the file was decrypted and verified${
                phase.attachments > 0
                  ? `, including ${phase.attachments} attached ${
                      phase.attachments === 1 ? 'file' : 'files'
                    }`
                  : ''
              }. It can be restored with this password. Nothing on this device was changed.`}
            </Text>
            <Button label="Done" onPress={navigation.goBack} />
          </View>
        )}
        {phase.kind === 'form' && (
          <View style={styles.form}>
            <Text variant="callout" color="textSecondary">
              Checks that a backup file is complete and that its password is
              right. Nothing on this device is changed.
            </Text>
            <PasswordField
              label="Backup password"
              value={password}
              onChangeText={setPassword}
            />
            {!!phase.error && (
              <Text variant="callout" color="danger">
                {phase.error}
              </Text>
            )}
            <Button
              label="Choose backup file"
              onPress={start}
              disabled={password.length === 0}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}
