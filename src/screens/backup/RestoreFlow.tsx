import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { nativeBackupPlatform } from '../../backup/platform';
import {
  restoreBackup,
  restoreCleanupPending,
  retryRestoreCleanup,
} from '../../backup/restore';
import {
  nativeRestorePlatform,
  RestoreError,
} from '../../backup/restorePlatform';
import { Button, Dialog, Text } from '../../components';
import { nativeReminderPlatform } from '../../reminders/platform';
import type { SerialDatabase } from '../../storage/serialDatabase';
import { useStrings } from '../../i18n';
import { strings } from '../../i18n/strings';
import { restoreErrorMessage } from './messages';
import { Busy, PasswordField, styles } from './parts';

type Phase =
  | { kind: 'checking' }
  | { kind: 'refused'; message: string }
  | { kind: 'form'; error?: string }
  | { kind: 'running' }
  | { kind: 'replacing' }
  | { kind: 'cleanup'; error?: string }
  | { kind: 'cleaning' };

/** The phases in which nothing else may happen (the gate may be held). */
export const busyPhases = ['running', 'replacing', 'cleanup', 'cleaning'];

interface RestoreFlowProps {
  /** The live database when the app is open; absent from the error screen (§8.1). */
  database?: SerialDatabase;
  fromErrorScreen: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
}

/**
 * Restore from a backup (spec v2.4 §8, v2.5 §6). Replace-only: after the
 * preconditions (§8.1), a file and its password, and a confirmation, the
 * restore runs behind a blocking screen. A failure before the swap leaves the
 * current data as it was and says why. From the swap on, the process restarts
 * and startup recovery finishes the restore; this screen never returns to the
 * old data (L1).
 */
export function RestoreFlow({
  database,
  fromErrorScreen,
  onBusyChange,
  onClose,
}: RestoreFlowProps) {
  const t = useStrings();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [uri, setUri] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [shares, setShares] = useState<{
    resolve: (answer: 'wait' | 'cancel') => void;
  } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    onBusyChange?.(busyPhases.includes(phase.kind));
  }, [phase.kind, onBusyChange]);

  useEffect(() => {
    if (restoreCleanupPending()) {
      setPhase({ kind: 'cleanup' });
      return;
    }
    let current = true;
    nativeRestorePlatform.preflight(fromErrorScreen).then(
      result => {
        if (!current) {
          return;
        }
        if (result.status === 'ready') {
          setPhase({ kind: 'form' });
        } else if (result.status === 'notOffered') {
          setPhase({
            kind: 'refused',
            message: strings().restore.noDataFile,
          });
        } else {
          setPhase({
            kind: 'refused',
            message: restoreErrorMessage({ code: result.code }),
          });
        }
      },
      e =>
        current &&
        setPhase({ kind: 'refused', message: restoreErrorMessage(e) }),
    );
    return () => {
      current = false;
    };
  }, [fromErrorScreen]);

  const chooseFile = async () => {
    try {
      const picked = await nativeBackupPlatform.pickBackupFile();
      if (picked) {
        setUri(picked);
      }
    } catch (e) {
      setPhase({ kind: 'form', error: restoreErrorMessage(e) });
    }
  };

  const restore = async () => {
    setConfirming(false);
    if (!uri || started.current) {
      return;
    }
    started.current = true;
    setPhase({ kind: 'running' });
    try {
      await restoreBackup({
        uri,
        password,
        database,
        firedOnceIds: database
          ? () => nativeReminderPlatform.getFiredOnceIds()
          : undefined,
        whileSharesActive: () => new Promise(resolve => setShares({ resolve })),
        onPrepared: async () => {
          // From here on the restore never comes back to this screen.
          setPhase({ kind: 'replacing' });
        },
      });
    } catch (e) {
      const error = RestoreError.from(e);
      setPassword('');
      started.current = false;
      setPhase(
        error.cleanedUp
          ? { kind: 'form', error: restoreErrorMessage(error) }
          : { kind: 'cleanup', error: restoreErrorMessage(error) },
      );
    }
  };

  const answerShares = (answer: 'wait' | 'cancel') => {
    shares?.resolve(answer);
    setShares(null);
  };

  const finishCleanup = async () => {
    setPhase({ kind: 'cleaning' });
    try {
      await retryRestoreCleanup();
      setPhase({
        kind: 'form',
        error: t.restore.stopped,
      });
    } catch (e) {
      setPhase({ kind: 'cleanup', error: restoreErrorMessage(e) });
    }
  };

  switch (phase.kind) {
    case 'checking':
      return (
        <Busy
          title={t.restore.preparing}
          message={t.restore.preparingMessage}
        />
      );
    case 'refused':
      return (
        <View style={styles.form}>
          <Text variant="callout">{phase.message}</Text>
          <Button
            label={t.common.close}
            variant="secondary"
            onPress={onClose}
          />
        </View>
      );
    case 'running':
      return (
        <>
          <Busy
            title={t.restore.restoring}
            message={t.restore.restoringMessage}
          />
          <Dialog
            visible={shares !== null}
            title={t.restore.sharingTitle}
            message={t.restore.sharingMessage}
            confirmLabel={t.restore.checkAgain}
            cancelLabel={t.restore.cancelRestore}
            onConfirm={() => answerShares('wait')}
            onCancel={() => answerShares('cancel')}
          />
        </>
      );
    case 'replacing':
      return (
        <Busy
          title={t.restore.finishing}
          message={t.restore.finishingMessage}
        />
      );
    case 'cleaning':
      return <Busy title={t.restore.cleaningUp} />;
    case 'cleanup':
      return (
        <View style={styles.form}>
          <Text variant="callout">
            {phase.error ??
              restoreErrorMessage({ code: 'RESTORE_RECOVERY_RETRY' })}
          </Text>
          <Button label={t.common.tryAgain} onPress={finishCleanup} />
        </View>
      );
    case 'form':
      return (
        <View style={styles.form}>
          <Text variant="callout" color="textSecondary">
            {t.restore.warning}
          </Text>
          <Button
            label={uri ? t.restore.chooseAnother : t.restore.chooseFile}
            variant="secondary"
            onPress={chooseFile}
          />
          {uri && (
            <Text variant="caption" color="textTertiary">
              {t.restore.fileChosen}
            </Text>
          )}
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
          <Button
            label={t.restore.restore}
            variant="destructive"
            onPress={() => setConfirming(true)}
            disabled={!uri || password.length === 0}
          />
          <Button label={t.common.cancel} variant="ghost" onPress={onClose} />
          <Dialog
            visible={confirming}
            title={t.restore.replaceTitle}
            message={t.restore.warning}
            confirmLabel={t.restore.replace}
            destructive
            onConfirm={restore}
            onCancel={() => setConfirming(false)}
          />
        </View>
      );
  }
}
