import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LucideIcon, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { canCancelRestore, cancelRestore } from '../backup/recovery';
import { restoreEntryFor } from '../backup/restore';
import { Button, Dialog, EmptyState, Screen, Text } from '../components';
import { useStrings } from '../i18n';
import type { Strings } from '../i18n/strings';
import { StorageError, StorageErrorCode } from '../storage/errors';
import { gutter, useTheme } from '../theme';
import { RestoreFlow } from './backup/RestoreFlow';

/** A key of the app language's `storageError` strings. */
type Copy = {
  [K in keyof Strings['storageError']]: Strings['storageError'][K] extends string
    ? K
    : never;
}[keyof Strings['storageError']];

interface ErrorCopy {
  icon: LucideIcon;
  title: Copy;
  message: Copy;
}

const keyProblem: ErrorCopy = {
  icon: ShieldAlert,
  title: 'keyTitle',
  message: 'keyMessage',
};

const updateNeeded: ErrorCopy = {
  icon: TriangleAlert,
  title: 'newerTitle',
  message: 'newerMessage',
};

const unreadable: ErrorCopy = {
  icon: TriangleAlert,
  title: 'corruptTitle',
  message: 'corruptMessage',
};

const generic: ErrorCopy = {
  icon: TriangleAlert,
  title: 'genericTitle',
  message: 'genericMessage',
};

const migrationProblem: ErrorCopy = {
  icon: TriangleAlert,
  title: 'migrationTitle',
  message: 'migrationMessage',
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
    title: 'restoreUnfinishedTitle',
    message: 'restoreVerifyMessage',
  },
  RESTORE_RECOVERY_RETRY: {
    icon: TriangleAlert,
    title: 'restoreUnfinishedTitle',
    message: 'restoreRetryMessage',
  },
  RESTORE_STATE_UNKNOWN: {
    icon: ShieldAlert,
    title: 'restoreUnknownTitle',
    message: 'restoreUnknownMessage',
  },
  RESTORE_UNAVAILABLE: {
    icon: ShieldAlert,
    title: 'restoreKeyTitle',
    message: 'restoreKeyMessage',
  },
  WIPE_INCOMPLETE: {
    icon: TriangleAlert,
    title: 'wipeTitle',
    message: 'wipeMessage',
  },
  RESTORE_IN_PROGRESS: {
    icon: TriangleAlert,
    title: 'restoreRunningTitle',
    message: 'restoreRunningMessage',
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
  const t = useStrings().storageError;
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
      <RestoreFlow
        fromErrorScreen
        onClose={() => setRestoring(false)}
        renderFrame={(content, actions) => (
          <Screen keyboardAware footer={actions}>
            <View style={styles.body}>{content}</View>
          </Screen>
        )}
      />
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
          title={t[copy.title]}
          message={`${t[copy.message]} ${t.keepInstalled}`}
          actionLabel={t.tryAgain}
          onActionPress={retry}
          actionDisabled={busy}
        />
        {entry === 'restore' && (
          <Button
            label={t.restore}
            onPress={() => setRestoring(true)}
            variant="ghost"
          />
        )}
        {entry === 'unavailable' && (
          <Text variant="caption" color="textSecondary" align="center">
            {t.restoreUnavailable}
          </Text>
        )}
        {cancelOffered && (
          <Button
            label={t.cancelRestore}
            onPress={() => setConfirming(true)}
            variant="ghost"
            disabled={cancelling}
          />
        )}
        <Text variant="caption" color="textTertiary" align="center">
          {t.errorCode(error.code)}
        </Text>
      </View>
      <Dialog
        visible={confirming}
        title={t.cancelTitle}
        message={t.cancelMessage}
        confirmLabel={t.returnToPrevious}
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
