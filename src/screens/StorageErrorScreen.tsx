import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LucideIcon, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { canCancelRestore, cancelRestore } from '../backup/recovery';
import { restoreEntryFor } from '../backup/restore';
import { Button, Dialog, EmptyState, Screen, Text } from '../components';
import { StorageError, StorageErrorCode } from '../storage/errors';
import { gutter, useTheme } from '../theme';
import { RestoreFlow } from './backup/RestoreFlow';

interface ErrorCopy {
  icon: LucideIcon;
  title: string;
  message: string;
}

const KEEP_INSTALLED =
  'Please don’t uninstall Trezor: that would permanently erase your data.';

const keyProblem: ErrorCopy = {
  icon: ShieldAlert,
  title: 'Trezor can’t unlock your data',
  message:
    'The encryption key that protects your data on this device is missing or no longer valid. Nothing has been deleted.',
};

const updateNeeded: ErrorCopy = {
  icon: TriangleAlert,
  title: 'Update Trezor to continue',
  message:
    'Your data was saved by a newer version of Trezor. Install the latest version to open it. Nothing has been changed.',
};

const unreadable: ErrorCopy = {
  icon: TriangleAlert,
  title: 'Your data couldn’t be opened',
  message:
    'The data file appears to be damaged or doesn’t match its key. Nothing has been deleted.',
};

const generic: ErrorCopy = {
  icon: TriangleAlert,
  title: 'Trezor couldn’t open your data',
  message:
    'Something went wrong while opening secure storage. Nothing has been deleted.',
};

const migrationProblem: ErrorCopy = {
  icon: TriangleAlert,
  title: 'Trezor couldn’t finish updating',
  message:
    'Your data couldn’t be upgraded to this version, so it was left exactly as it was.',
};

const copyByCode: Partial<Record<StorageErrorCode, ErrorCopy>> = {
  KEY_MISSING_FOR_DATABASE: keyProblem,
  INVALID_KEY_FORMAT: keyProblem,
  MASTER_KEY_MISSING: keyProblem,
  KEY_INVALIDATED: keyProblem,
  UNWRAP_FAILED: keyProblem,
  KEY_NOT_FOUND: keyProblem,
  ENVELOPE_UNSUPPORTED: updateNeeded,
  NEWER_SCHEMA: updateNeeded,
  DATABASE_UNREADABLE: unreadable,
  DATABASE_CORRUPT: unreadable,
  MIGRATION_FAILED: migrationProblem,
  SNAPSHOT_FAILED: migrationProblem,
  RESTORE_VERIFY_RETRY: {
    icon: TriangleAlert,
    title: 'The restore isn’t finished yet',
    message:
      'Trezor couldn’t check the restored data just now. Your data from before the restore is kept until it can.',
  },
  RESTORE_RECOVERY_RETRY: {
    icon: TriangleAlert,
    title: 'The restore isn’t finished yet',
    message:
      'A step of the restore couldn’t be completed. Nothing has been lost; trying again continues where it stopped.',
  },
  RESTORE_STATE_UNKNOWN: {
    icon: ShieldAlert,
    title: 'An unfinished restore needs attention',
    message:
      'Trezor found restore files it can’t account for. To protect your data, nothing is changed automatically.',
  },
  RESTORE_UNAVAILABLE: {
    icon: ShieldAlert,
    title: 'Trezor can’t finish the restore',
    message:
      'The encryption key on this device is missing or no longer valid. All restore files are kept.',
  },
  RESTORE_IN_PROGRESS: {
    icon: TriangleAlert,
    title: 'A restore is still running',
    message: 'Wait a moment, then try again.',
  },
};

/** Cancel restore (Phase 6 spec v2.5 §2); replaceable in tests. */
export interface RestoreCancel {
  /** Whether it may be offered; never changes anything. */
  available: () => Promise<boolean>;
  /** Checks again, then starts the rollback on the next Retry. */
  cancel: () => Promise<void>;
}

const nativeRestoreCancel: RestoreCancel = {
  available: () => canCancelRestore(),
  cancel: () => cancelRestore(),
};

interface StorageErrorScreenProps {
  error: StorageError;
  onRetry: () => void;
  restoreCancel?: RestoreCancel;
}

/**
 * Shown when storage can't be opened. Offers retry; never erases data. After
 * a restore whose verification couldn't finish (`RESTORE_VERIFY_RETRY`), and
 * only when the data from before the restore checks out, it also offers to
 * cancel the restore and return to that data, after a confirmation. While
 * that check or the cancel runs, Retry is disabled (native recovery refuses
 * a second run anyway, `RESTORE_IN_PROGRESS`), and a cancel runs only once.
 */
export function StorageErrorScreen({
  error,
  onRetry,
  restoreCancel = nativeRestoreCancel,
}: StorageErrorScreenProps) {
  const { scheme } = useTheme();
  const copy = copyByCode[error.code] ?? generic;
  const [cancelOffered, setCancelOffered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** Set synchronously, so a second confirmation can't start a second cancel. */
  const cancelStarted = useRef(false);
  /** Bumped after a failed cancel, to check availability again. */
  const [recheck, setRecheck] = useState(0);
  const busy = checking || cancelling;
  const entry = restoreEntryFor(error.code);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setCancelOffered(false);
    if (error.code !== 'RESTORE_VERIFY_RETRY') {
      return;
    }
    let current = true;
    setChecking(true);
    restoreCancel
      .available()
      .then(
        offered => {
          if (current) {
            setCancelOffered(offered);
          }
        },
        () => undefined,
      )
      .finally(() => {
        if (current) {
          setChecking(false);
        }
      });
    return () => {
      current = false;
    };
  }, [error, restoreCancel, recheck]);

  const retry = () => {
    if (!busy && !cancelStarted.current) {
      onRetry();
    }
  };

  const confirmCancel = () => {
    setConfirming(false);
    if (cancelStarted.current) {
      return;
    }
    cancelStarted.current = true;
    setCancelling(true);
    restoreCancel.cancel().then(
      // The next recovery run rolls back.
      () => onRetry(),
      () => {
        // Nothing changed; the controls come back for what is possible now.
        console.warn('[restore] cancel not possible');
        cancelStarted.current = false;
        setCancelling(false);
        setRecheck(n => n + 1);
      },
    );
  };

  if (restoring) {
    // §8.1: restore over data that can't be opened; no live connection.
    return (
      <Screen keyboardAware>
        <View style={styles.body}>
          <RestoreFlow fromErrorScreen onClose={() => setRestoring(false)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View style={styles.body}>
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          message={`${copy.message} ${KEEP_INSTALLED}`}
          actionLabel="Try again"
          onActionPress={retry}
          actionDisabled={busy}
        />
        {entry === 'restore' && (
          <Button
            label="Restore from a backup"
            onPress={() => setRestoring(true)}
            variant="ghost"
          />
        )}
        {entry === 'unavailable' && (
          <Text variant="caption" color="textSecondary" align="center">
            Restoring a backup isn’t possible on this device while its key is
            missing or invalid (RESTORE_UNAVAILABLE).
          </Text>
        )}
        {cancelOffered && (
          <Button
            label="Cancel restore and return to previous data"
            onPress={() => setConfirming(true)}
            variant="ghost"
            disabled={cancelling}
          />
        )}
        <Text variant="caption" color="textTertiary" align="center">
          Error code: {error.code}
        </Text>
      </View>
      <Dialog
        visible={confirming}
        title="Cancel restore?"
        message="The restored data will be discarded and Trezor returns to the data you had before the restore."
        confirmLabel="Return to previous data"
        destructive
        onConfirm={confirmCancel}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: gutter, paddingTop: 48 },
});
