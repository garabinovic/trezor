import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LucideIcon, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { canCancelRestore, cancelRestore } from '../backup/recovery';
import { Button, Dialog, EmptyState, Screen, Text } from '../components';
import { StorageError, StorageErrorCode } from '../storage/errors';
import { gutter, useTheme } from '../theme';

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
 * cancel the restore and return to that data, after a confirmation.
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

  useEffect(() => {
    setCancelOffered(false);
    if (error.code !== 'RESTORE_VERIFY_RETRY') {
      return;
    }
    let current = true;
    restoreCancel.available().then(
      offered => {
        if (current) {
          setCancelOffered(offered);
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [error, restoreCancel]);

  const confirmCancel = () => {
    setConfirming(false);
    setCancelOffered(false);
    // Either way the next recovery run decides: a rollback, or this screen again.
    restoreCancel
      .cancel()
      .catch(() => console.warn('[restore] cancel not possible'))
      .finally(onRetry);
  };

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
          onActionPress={onRetry}
        />
        {cancelOffered && (
          <Button
            label="Cancel restore and return to previous data"
            onPress={() => setConfirming(true)}
            variant="ghost"
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
