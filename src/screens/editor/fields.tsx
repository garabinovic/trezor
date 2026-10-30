import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import {
  Button,
  ChipGroup,
  ChipOption,
  DateField,
  Text,
  TextField,
} from '../../components';
import {
  CardCodeFormat,
  DocumentKind,
  documentKinds,
  ItemOfType,
  ItemType,
  parseIsoDate,
  ReminderRepeat,
  toIsoDate,
} from '../../data';
import { spacing } from '../../theme';
import { FieldErrors } from './drafts';

export interface FieldsProps<T extends ItemType> {
  draft: ItemOfType<T>;
  onChange: (patch: Partial<ItemOfType<T>>) => void;
  errors: FieldErrors;
}

export function NoteFields({ draft, onChange, errors }: FieldsProps<'note'>) {
  return (
    <>
      <TextField
        label="Title"
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder="e.g. Gift ideas"
        error={errors.title}
        autoFocus={!draft.title}
        returnKeyType="next"
      />
      <TextField
        label="Note"
        value={draft.body}
        onChangeText={body => onChange({ body })}
        placeholder="Write anything you want to keep"
        multiline
      />
    </>
  );
}

const repeatOptions: ChipOption<ReminderRepeat>[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function ReminderFields({
  draft,
  onChange,
  errors,
}: FieldsProps<'reminder'>) {
  const due = new Date(draft.dueAt);

  const setDate = (date: Date | null) => {
    if (!date) {
      return;
    }
    const next = new Date(due);
    next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    onChange({ dueAt: next.toISOString() });
  };
  const setTime = (time: Date | null) => {
    if (!time) {
      return;
    }
    const next = new Date(due);
    next.setHours(time.getHours(), time.getMinutes(), 0, 0);
    onChange({ dueAt: next.toISOString() });
  };

  return (
    <>
      <TextField
        label="Title"
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder="e.g. Renew car insurance"
        error={errors.title}
        autoFocus={!draft.title}
      />
      <View style={styles.row}>
        <DateField label="Date" value={due} onChange={setDate} />
        <DateField label="Time" mode="time" value={due} onChange={setTime} />
      </View>
      <FieldGroup label="Repeat">
        <ChipGroup
          label="Repeat"
          options={repeatOptions}
          value={draft.repeat}
          onChange={repeat => onChange({ repeat })}
          inset={false}
        />
      </FieldGroup>
      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder="Optional"
        multiline
      />
      <Text variant="caption" color="textTertiary">
        Notifications are not available yet. Reminders are shown in the app
        only.
      </Text>
    </>
  );
}

const codeFormatOptions: ChipOption<CardCodeFormat>[] = [
  { value: 'barcode', label: 'Barcode' },
  { value: 'qr', label: 'QR code' },
];

export function CardFields({ draft, onChange, errors }: FieldsProps<'card'>) {
  return (
    <>
      <TextField
        label="Store or card name"
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder="e.g. Greenleaf Market"
        error={errors.title}
        autoFocus={!draft.title}
      />
      <TextField
        label="Card number"
        value={draft.cardNumber}
        onChangeText={cardNumber => onChange({ cardNumber })}
        placeholder="As printed on the card"
        error={errors.cardNumber}
        helper="Scanning a card with the camera will come in a later version."
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <FieldGroup label="Code type">
        <ChipGroup
          label="Code type"
          options={codeFormatOptions}
          value={draft.codeFormat}
          onChange={codeFormat => onChange({ codeFormat })}
          inset={false}
        />
      </FieldGroup>
      <TextField
        label="Cardholder"
        value={draft.holderName}
        onChangeText={holderName => onChange({ holderName })}
        placeholder="Optional"
        autoCapitalize="words"
      />
      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder="Optional"
        multiline
      />
    </>
  );
}

const kindOptions: ChipOption<DocumentKind>[] = (
  Object.keys(documentKinds) as DocumentKind[]
).map(value => ({ value, label: documentKinds[value].label }));

function isoToDate(value: string | null): Date | null {
  return value ? parseIsoDate(value) : null;
}

export function DocumentFields({
  draft,
  onChange,
  errors,
}: FieldsProps<'document'>) {
  const [amountText, setAmountText] = useState(
    draft.amount != null ? String(draft.amount) : '',
  );
  const purchase = draft.kind === 'receipt' || draft.kind === 'warranty';

  const changeAmount = (text: string) => {
    setAmountText(text);
    const normalized = text.trim().replace(',', '.');
    onChange({ amount: normalized ? Number(normalized) : null });
  };

  return (
    <>
      <FieldGroup label="Type">
        <ChipGroup
          label="Document type"
          options={kindOptions}
          value={draft.kind}
          onChange={kind => onChange({ kind })}
          inset={false}
        />
      </FieldGroup>
      <TextField
        label="Title"
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder={purchase ? 'e.g. Washing machine' : 'e.g. Apartment lease'}
        error={errors.title}
        autoFocus={!draft.title}
      />
      <TextField
        label="Store or issuer"
        value={draft.merchant}
        onChangeText={merchant => onChange({ merchant })}
        placeholder="Optional"
      />
      <DateField
        label={purchase ? 'Purchase date' : 'Issue date'}
        value={isoToDate(draft.date)}
        onChange={d => onChange({ date: d ? toIsoDate(d) : null })}
        clearable
      />
      <DateField
        label={draft.kind === 'warranty' ? 'Warranty until' : 'Expires on'}
        value={isoToDate(draft.expiresOn)}
        onChange={d => onChange({ expiresOn: d ? toIsoDate(d) : null })}
        error={errors.expiresOn}
        clearable
      />
      {purchase && (
        <View style={styles.row}>
          <View style={styles.amount}>
            <TextField
              label="Amount"
              value={amountText}
              onChangeText={changeAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              error={errors.amount}
            />
          </View>
          <View style={styles.currency}>
            <TextField
              label="Currency"
              value={draft.currency}
              onChangeText={currency => onChange({ currency })}
              autoCapitalize="characters"
              maxLength={3}
            />
          </View>
        </View>
      )}
      <FieldGroup label="Attachment">
        <Button
          label="Attach file"
          icon={Paperclip}
          variant="secondary"
          onPress={() => {}}
          disabled
        />
        <Text variant="caption" color="textTertiary">
          {draft.attachment
            ? `${draft.attachment.fileName} is attached. Changing files is not available yet.`
            : 'Adding photos and files is not available yet.'}
        </Text>
      </FieldGroup>
      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder="Optional"
        multiline
      />
    </>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  amount: { flex: 2 },
  currency: { flex: 1 },
  group: { gap: spacing.sm },
});
