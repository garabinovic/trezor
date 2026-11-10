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

const REPLACE_WARNING =
  'Everything in Trezor on this device is replaced by the contents of the backup: your current notes, reminders, cards, documents and attached files. This can’t be undone.';

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
            message:
              'There’s no data file on this device to restore over. Try again instead.',
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
        error: 'The restore was stopped. Your data is as it was before.',
      });
    } catch (e) {
      setPhase({ kind: 'cleanup', error: restoreErrorMessage(e) });
    }
  };

  switch (phase.kind) {
    case 'checking':
      return (
        <Busy
          title="Preparing…"
          message="Checking whether a restore is possible."
        />
      );
    case 'refused':
      return (
        <View style={styles.form}>
          <Text variant="callout">{phase.message}</Text>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      );
    case 'running':
      return (
        <>
          <Busy
            title="Restoring…"
            message="The backup is being read and checked. Keep Trezor open until this is done."
          />
          <Dialog
            visible={shares !== null}
            title="A file is still being shared"
            message="Trezor is handing a file to another app. Wait until that has finished, or cancel the restore."
            confirmLabel="Check again"
            cancelLabel="Cancel restore"
            onConfirm={() => answerShares('wait')}
            onCancel={() => answerShares('cancel')}
          />
        </>
      );
    case 'replacing':
      return (
        <Busy
          title="Finishing the restore…"
          message="Trezor restarts by itself now. If it doesn’t: Restore isn’t finished yet. Close and reopen Trezor to complete it."
        />
      );
    case 'cleaning':
      return <Busy title="Putting your data back in order…" />;
    case 'cleanup':
      return (
        <View style={styles.form}>
          <Text variant="callout">
            {phase.error ??
              restoreErrorMessage({ code: 'RESTORE_RECOVERY_RETRY' })}
          </Text>
          <Button label="Try again" onPress={finishCleanup} />
        </View>
      );
    case 'form':
      return (
        <View style={styles.form}>
          <Text variant="callout" color="textSecondary">
            {REPLACE_WARNING}
          </Text>
          <Button
            label={uri ? 'Choose another file' : 'Choose backup file'}
            variant="secondary"
            onPress={chooseFile}
          />
          {uri && (
            <Text variant="caption" color="textTertiary">
              Backup file chosen.
            </Text>
          )}
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
            label="Restore"
            variant="destructive"
            onPress={() => setConfirming(true)}
            disabled={!uri || password.length === 0}
          />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
          <Dialog
            visible={confirming}
            title="Replace all data?"
            message={REPLACE_WARNING}
            confirmLabel="Replace"
            destructive
            onConfirm={restore}
            onCancel={() => setConfirming(false)}
          />
        </View>
      );
  }
}
