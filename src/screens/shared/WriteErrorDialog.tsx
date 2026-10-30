import React from 'react';
import { Dialog } from '../../components';
import { useItems } from '../../data';

/** Tells the user when a change could not be saved (state has been reloaded). */
export function WriteErrorDialog() {
  const { writeError, dismissWriteError } = useItems();
  return (
    <Dialog
      visible={writeError}
      title="Couldn’t save your change"
      message="Your last change wasn’t saved. The list now shows what is stored on this device. Please try again."
      confirmLabel="OK"
      cancelLabel={null}
      onConfirm={dismissWriteError}
      onCancel={dismissWriteError}
    />
  );
}
