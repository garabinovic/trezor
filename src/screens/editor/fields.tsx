import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ImagePlus, Paperclip } from 'lucide-react-native';
import { AttachmentImage } from '../../attachments/AttachmentImage';
import { toAttachmentError } from '../../attachments/platform';
import {
  Button,
  ChipGroup,
  ChipOption,
  DateField,
  Text,
  TextField,
} from '../../components';
import {
  DocumentKind,
  documentKinds,
  ItemOfType,
  ItemType,
  LoyaltyCard,
  formatDate,
  formatTime,
  parseIsoDate,
  Reminder,
  ReminderRepeat,
  toIsoDate,
} from '../../data';
import { spacing } from '../../theme';
import type { AttachmentSession } from './attachmentSession';
import { importFailureText, pickErrorText } from './attachmentMessages';
import { FieldErrors } from './drafts';
import {
  INTERVAL_PRESETS,
  intervalLabel,
  withStart,
} from '../../reminders/reminderSchedule';

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
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'interval', label: 'Interval' },
];

const intervalOptions: ChipOption<string>[] = INTERVAL_PRESETS.map(m => ({
  value: String(m),
  label: m === 60 ? '1 hour' : `${m / 60} hours`,
}));

const DEFAULT_INTERVAL = 240;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** One plain sentence describing when notifications will come. */
export function scheduleHint(reminder: Reminder): string {
  const due = new Date(reminder.dueAt);
  const time = formatTime(due);
  const day = due.getDate();
  switch (reminder.repeat) {
    case 'once':
      return 'Notifies once at this time.';
    case 'daily':
      return `Notifies every day at ${time}.`;
    case 'weekly':
      return `Notifies every ${WEEKDAYS[due.getDay()]} at ${time}.`;
    case 'monthly':
      return `Notifies on day ${day} of every month at ${time}.${
        day > 28 ? ' In shorter months, on the last day.' : ''
      }`;
    case 'yearly':
      return `Notifies every year on ${formatDate(due, new Date(0)).replace(
        / \d{4}$/,
        '',
      )} at ${time}.${
        due.getMonth() === 1 && day === 29
          ? ' In other years, on 28 February.'
          : ''
      }`;
    case 'interval':
      return `Notifies ${intervalLabel(
        reminder.intervalMinutes ?? DEFAULT_INTERVAL,
      ).toLowerCase()}, starting at the date and time above.`;
  }
}

export function ReminderFields({
  draft,
  onChange,
  errors,
  onTime = true,
}: FieldsProps<'reminder'> & {
  /** Exact alarms allowed; otherwise Android may deliver late. */
  onTime?: boolean;
}) {
  const due = new Date(draft.dueAt);

  // Date and time update the instant and the floating local start together.
  const setStart = (next: Date) => {
    const { dueAt, localStart } = withStart(draft, next.getTime());
    onChange({ dueAt, localStart });
  };
  const setDate = (date: Date | null) => {
    if (date) {
      const next = new Date(due);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      setStart(next);
    }
  };
  const setTime = (time: Date | null) => {
    if (time) {
      const next = new Date(due);
      next.setHours(time.getHours(), time.getMinutes(), 0, 0);
      setStart(next);
    }
  };
  const setRepeat = (repeat: ReminderRepeat) =>
    onChange({
      repeat,
      intervalMinutes:
        repeat === 'interval'
          ? draft.intervalMinutes ?? DEFAULT_INTERVAL
          : null,
    });

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
        <DateField
          label="Date"
          value={due}
          onChange={setDate}
          error={errors.dueAt}
        />
        <DateField label="Time" mode="time" value={due} onChange={setTime} />
      </View>
      <FieldGroup label="Repeat">
        <ChipGroup
          label="Repeat"
          options={repeatOptions}
          value={draft.repeat}
          onChange={setRepeat}
          inset={false}
        />
      </FieldGroup>
      {draft.repeat === 'interval' && (
        <FieldGroup label="Every">
          <ChipGroup
            label="Interval"
            options={intervalOptions}
            value={String(draft.intervalMinutes ?? DEFAULT_INTERVAL)}
            onChange={value => onChange({ intervalMinutes: Number(value) })}
            inset={false}
          />
        </FieldGroup>
      )}
      <Text variant="caption" color="textSecondary">
        {scheduleHint(draft)}
      </Text>
      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder="Optional"
        multiline
      />
      {!onTime && (
        <Text variant="caption" color="textTertiary">
          Notifications may arrive late as Android saves battery. Allow “Alarms
          & reminders” in Settings so they arrive on time.
        </Text>
      )}
    </>
  );
}

export function CardFields({
  draft,
  onChange,
  errors,
  attachments,
}: FieldsProps<'card'> & { attachments: AttachmentSession }) {
  // The stored code type (barcode / QR) is kept but not offered until codes
  // can be scanned or shown for real.
  return (
    <>
      <TextField
        label="Card name"
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder="e.g. Greenleaf Rewards"
        error={errors.title}
        autoFocus={!draft.title}
      />
      <TextField
        label="Issuer"
        value={draft.issuer}
        onChangeText={issuer => onChange({ issuer })}
        placeholder="Store or programme, optional"
        autoCapitalize="words"
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
      <CardPhotos draft={draft} onChange={onChange} session={attachments} />
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

type CardSide = 'frontImage' | 'backImage';

const sideNames: Record<CardSide, string> = {
  frontImage: 'front',
  backImage: 'back',
};

function CardPhotos({
  draft,
  onChange,
  session,
}: {
  draft: LoyaltyCard;
  onChange: (patch: Partial<LoyaltyCard>) => void;
  session: AttachmentSession;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (side: CardSide) => {
    const previous = draft[side];
    setProblem(null);
    setBusy(true);
    try {
      const result = await session.pick({
        source: 'photos',
        imagesOnly: true,
        maxCount: 1,
      });
      if (!result) {
        return;
      }
      const [photo] = result.imported;
      if (photo) {
        onChange({ [side]: photo });
        if (previous) {
          session.release([previous.id]);
        }
      }
      if (result.failed.length > 0) {
        setProblem(importFailureText(result.failed[0]));
      }
    } catch (e) {
      setProblem(pickErrorText(toAttachmentError(e).code));
    } finally {
      setBusy(false);
    }
  };

  const remove = (side: CardSide) => {
    const previous = draft[side];
    onChange({ [side]: null });
    if (previous) {
      session.release([previous.id]);
    }
  };

  return (
    <FieldGroup label="Card photos">
      <View style={styles.row}>
        {(['frontImage', 'backImage'] as const).map(side => {
          const photo = draft[side];
          const name = sideNames[side];
          return (
            <View key={side} style={styles.photoSlot}>
              <Text variant="caption" color="textSecondary">
                {name === 'front' ? 'Front' : 'Back'}
              </Text>
              {photo ? (
                <>
                  <AttachmentImage
                    attachment={photo}
                    label={`Photo of the ${name} of the card`}
                  />
                  <View style={styles.photoActions}>
                    <Button
                      label="Replace"
                      accessibilityLabel={`Replace ${name} photo`}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onPress={() => pick(side)}
                    />
                    <Button
                      label="Remove"
                      accessibilityLabel={`Remove ${name} photo`}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onPress={() => remove(side)}
                    />
                  </View>
                </>
              ) : (
                <Button
                  label={`Add ${name}`}
                  accessibilityLabel={`Add ${name} photo`}
                  icon={ImagePlus}
                  variant="secondary"
                  size="sm"
                  fullWidth
                  disabled={busy}
                  onPress={() => pick(side)}
                />
              )}
            </View>
          );
        })}
      </View>
      {problem && (
        <Text variant="caption" color="danger">
          {problem}
        </Text>
      )}
      <Text variant="caption" color="textTertiary">
        Optional. Photos are encrypted and stay on this device.
      </Text>
    </FieldGroup>
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
          {draft.attachments.length > 0
            ? `${draft.attachments.length} attached. Changing files is not available yet.`
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
  photoSlot: { flex: 1, gap: spacing.xs },
  photoActions: { flexDirection: 'row', justifyContent: 'space-between' },
});
