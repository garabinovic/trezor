import React from 'react';
import { Dialog } from '../../components';
import { useItems } from '../../data';
import { useStrings } from '../../i18n';

/** Tells the user when a change could not be saved (state has been reloaded). */
export function WriteErrorDialog() {
  const { writeError, dismissWriteError } = useItems();
  const t = useStrings();
  return (
    <Dialog
      visible={writeError}
      title={t.items.writeErrorTitle}
      message={t.items.writeErrorMessage}
      confirmLabel={t.common.ok}
      cancelLabel={null}
      onConfirm={dismissWriteError}
      onCancel={dismissWriteError}
    />
  );
}
