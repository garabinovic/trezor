import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { X } from 'lucide-react-native';
import { BarHeader, Button, Dialog, Screen } from '../components';
import { categories, Item, useItem, useItems } from '../data';
import { RootStackParamList } from '../navigation/types';
import { gutter, spacing } from '../theme';
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const noun = categories[type].singular.toLowerCase();

  usePreventRemove(dirty && !saved, ({ data }) => {
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

  const save = () => {
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    saveItem(normalize(draft));
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
          title={existing ? `Edit ${noun}` : `New ${noun}`}
          onBack={navigation.goBack}
          backIcon={X}
          backLabel="Cancel"
          actions={
            <View style={styles.save}>
              <Button label="Save" size="sm" onPress={save} />
            </View>
          }
        />
      }
    >
      <View style={styles.form}>
        {draft.type === 'note' && <NoteFields draft={draft} {...fieldProps} />}
        {draft.type === 'reminder' && (
          <ReminderFields draft={draft} {...fieldProps} />
        )}
        {draft.type === 'card' && <CardFields draft={draft} {...fieldProps} />}
        {draft.type === 'document' && (
          <DocumentFields draft={draft} {...fieldProps} />
        )}
      </View>

      <Dialog
        visible={pendingLeave !== null}
        title="Discard changes?"
        message={`Your changes to this ${noun} will not be saved.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
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
  save: { paddingRight: spacing.sm },
});
