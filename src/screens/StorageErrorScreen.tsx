import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { LucideIcon, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { EmptyState, Screen, Text } from '../components';
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

interface StorageErrorScreenProps {
  error: StorageError;
  onRetry: () => void;
}

/** Shown when storage can't be opened. Offers retry only; never erases data. */
export function StorageErrorScreen({
  error,
  onRetry,
}: StorageErrorScreenProps) {
  const { scheme } = useTheme();
  const copy = copyByCode[error.code] ?? generic;
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
        <Text variant="caption" color="textTertiary" align="center">
          Error code: {error.code}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: gutter, paddingTop: 48 },
});
