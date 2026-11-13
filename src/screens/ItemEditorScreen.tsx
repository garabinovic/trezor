import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { X } from 'lucide-react-native';
import { BarHeader, Button, Dialog, Screen } from '../components';
import { attachmentIdsOf, Item, useItem, useItems } from '../data';
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { useReminders } from '../reminders/RemindersProvider';
import { gutter, spacing } from '../theme';
import { useAttachmentSession } from './editor/attachmentSession';
import {
  createBlankItem,
  FieldErrors,
  normalize,
  validate,
} from './editor/drafts';
import {
  CardFields,
  DocumentFields,
  NoteFields,
  ReminderFields,
} from './editor/fields';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemEditor'>;

export function ItemEditorScreen({ route, navigation }: Props) {
  const { type, id } = route.params;
  const existing = useItem(id);
  const { saveItem } = useItems();
  const { requestPermissionIfNeeded, exactAlarmsAllowed } = useReminders();
  // Files picked here are deleted unless the save keeps them.
  const attachments = useAttachmentSession();

  const initial = useMemo(
    () => existing ?? createBlankItem(type),
    // Snapshot once: later store updates must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<Item>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [saved, setSaved] = useState(false);
  // The write is running: no second Save, and the editor stays open.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const t = useStrings();
  const text = t.categories[type];

  usePreventRemove(saving || (dirty && !saved), ({ data }) => {
    if (savingRef.current) {
      // Leaving now could lose the draft if the write fails.
      return;
    }
    setPendingLeave(() => () => navigation.dispatch(data.action));
  });

  const onChange = (patch: Partial<Item>) => {
    setDraft(current => ({ ...current, ...patch } as Item));
    // Clear an error as soon as its field is edited.
    const keys = Object.keys(patch);
    if (keys.some(k => errors[k])) {
      setErrors(current => {
        const next = { ...current };
        keys.forEach(k => delete next[k]);
        return next;
      });
    }
  };

  const save = async () => {
    // Files are still being added: saving now would leave them out.
    if (attachments.busy || savingRef.current) {
      return;
    }
    const nextErrors = validate(draft, existing);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const item = normalize(draft);
    const keptIds = attachmentIdsOf(item);
    savingRef.current = true;
    setSaving(true);
    let stored = false;
    let reopen: (() => void) | null = null;
    try {
      reopen = attachments.commit(keptIds);
      stored = await saveItem(item);
    } catch {
      // saveItem reports failures as false; anything thrown is unexpected.
      console.warn('[editor] save failed');
    } finally {
      if (!stored) {
        // Not stored: the draft and its new files stay, and Save can be
        // tried again. Never left stuck in "saving".
        reopen?.();
        savingRef.current = false;
        setSaving(false);
      }
    }
    if (!stored) {
      return;
    }
    if (draft.type === 'reminder' && !draft.completed) {
      // Explains and asks for notification permission the first time only.
      requestPermissionIfNeeded();
    }
    savingRef.current = false;
    setSaving(false);
    setSaved(true);
  };

  // Leave only after the re-render that lifts the unsaved-changes guard.
  useEffect(() => {
    if (saved) {
      navigation.goBack();
    }
  }, [saved, navigation]);

  const fieldProps = { errors, onChange };

  return (
    <Screen
      keyboardAware
      header={
        <BarHeader
          title={existing ? text.editTitle : text.newTitle}
          onBack={navigation.goBack}
          backIcon={X}
          backLabel={t.common.cancel}
        />
      }
      footer={
        <Button
          label={t.common.save}
          onPress={save}
          disabled={attachments.busy || saving}
          fullWidth
        />
      }
    >
      <View style={styles.form}>
        {draft.type === 'note' && <NoteFields draft={draft} {...fieldProps} />}
        {draft.type === 'reminder' && (
          <ReminderFields
            draft={draft}
            onTime={exactAlarmsAllowed !== false}
            {...fieldProps}
          />
        )}
        {draft.type === 'card' && (
          <CardFields
            draft={draft}
            attachmentSession={attachments}
            {...fieldProps}
          />
        )}
        {draft.type === 'document' && (
          <DocumentFields
            draft={draft}
            attachmentSession={attachments}
            {...fieldProps}
          />
        )}
      </View>

      <Dialog
        visible={pendingLeave !== null}
        title={t.editor.discardTitle}
        message={text.discardMessage}
        confirmLabel={t.editor.discard}
        cancelLabel={t.editor.keepEditing}
        destructive
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    gap: spacing.xxl,
  },
});
