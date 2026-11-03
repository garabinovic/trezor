import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  FilePlus,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { AttachmentImage } from '../../attachments/AttachmentImage';
import { PickSource, toAttachmentError } from '../../attachments/platform';
import {
  Button,
  ChipGroup,
  ChipOption,
  DateField,
  Icon,
  IconButton,
  ListItem,
  Sheet,
  Text,
  TextField,
} from '../../components';
import {
  Attachment,
  describeAttachment,
  DocumentItem,
  DocumentKind,
  isImage,
  MAX_DOCUMENT_ATTACHMENTS,
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
import { spacing, Theme, useStyles } from '../../theme';
import type { AttachmentSession } from './attachmentSession';
import {
  importFailureText,
  pickErrorText,
  skippedText,
} from './attachmentMessages';
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
  attachmentSession,
}: FieldsProps<'card'> & { attachmentSession: AttachmentSession }) {
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
      <CardPhotos
        draft={draft}
        onChange={onChange}
        session={attachmentSession}
      />
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
  attachmentSession,
}: FieldsProps<'document'> & { attachmentSession: AttachmentSession }) {
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
      <DocumentAttachments
        draft={draft}
        onChange={onChange}
        session={attachmentSession}
        error={errors.attachments}
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

/**
 * A document's files, in display order: add photos or files (images and
 * PDFs), and per file move, replace or remove. Same file lifecycle as card
 * photos (see attachmentSession.ts).
 */
function DocumentAttachments({
  draft,
  onChange,
  session,
  error,
}: {
  draft: DocumentItem;
  onChange: (patch: Partial<DocumentItem>) => void;
  session: AttachmentSession;
  error?: string;
}) {
  const themed = useStyles(createThemedStyles);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const files = draft.attachments;
  const remaining = MAX_DOCUMENT_ATTACHMENTS - files.length;
  const selectedIndex = files.findIndex(a => a.id === selectedId);
  const selected = selectedIndex >= 0 ? files[selectedIndex] : null;

  /** Runs one pick; `apply` gets what was imported. */
  const run = async (
    source: PickSource,
    maxCount: number,
    apply: (imported: Attachment[]) => void,
  ) => {
    setProblems([]);
    setBusy(true);
    try {
      const result = await session.pick({
        source,
        imagesOnly: source === 'photos',
        maxCount,
      });
      if (!result) {
        return;
      }
      if (result.imported.length > 0) {
        apply(result.imported);
      }
      setProblems([
        ...result.failed.map(f => importFailureText(f, 'file')),
        ...(result.skipped > 0
          ? [skippedText(result.skipped, MAX_DOCUMENT_ATTACHMENTS)]
          : []),
      ]);
    } catch (e) {
      const text = pickErrorText(
        toAttachmentError(e).code,
        source === 'photos' ? 'photo' : 'file',
      );
      setProblems(text ? [text] : []);
    } finally {
      setBusy(false);
    }
  };

  const add = (source: PickSource) =>
    run(source, remaining, imported =>
      onChange({ attachments: [...files, ...imported] }),
    );

  const replace = (old: Attachment) => {
    setSelectedId(null);
    run('files', 1, ([next]) => {
      onChange({
        attachments: files.map(a => (a.id === old.id ? next : a)),
      });
      session.release([old.id]);
    });
  };

  const remove = (old: Attachment) => {
    setSelectedId(null);
    onChange({ attachments: files.filter(a => a.id !== old.id) });
    session.release([old.id]);
  };

  const move = (from: number, to: number) => {
    setSelectedId(null);
    const next = [...files];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ attachments: next });
  };

  return (
    <FieldGroup label="Attachments">
      {files.map(a => (
        <View key={a.id} style={themed.fileRow}>
          <Icon icon={isImage(a) ? ImageIcon : FileText} />
          <View style={styles.fileText}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {a.fileName}
            </Text>
            <Text variant="caption" color="textSecondary">
              {describeAttachment(a)}
            </Text>
          </View>
          <IconButton
            icon={EllipsisVertical}
            label={`Options for ${a.fileName}`}
            color="textSecondary"
            onPress={() => !busy && setSelectedId(a.id)}
          />
        </View>
      ))}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            label="Add photos"
            icon={ImagePlus}
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy || remaining <= 0}
            onPress={() => add('photos')}
          />
        </View>
        <View style={styles.flex}>
          <Button
            label="Add files"
            icon={FilePlus}
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy || remaining <= 0}
            onPress={() => add('files')}
          />
        </View>
      </View>
      {[...(error ? [error] : []), ...problems].map(text => (
        <Text key={text} variant="caption" color="danger">
          {text}
        </Text>
      ))}
      <Text variant="caption" color="textTertiary">
        {remaining > 0
          ? `Photos or PDFs, up to ${MAX_DOCUMENT_ATTACHMENTS} files of 25 MB each. Files are encrypted and stay on this device.`
          : `${MAX_DOCUMENT_ATTACHMENTS} of ${MAX_DOCUMENT_ATTACHMENTS} files attached. Remove one to add another.`}
      </Text>
      <Sheet
        visible={selected !== null}
        title={selected?.fileName ?? ''}
        onClose={() => setSelectedId(null)}
      >
        {selected && (
          <>
            <ListItem
              icon={ArrowUp}
              title="Move up"
              disabled={selectedIndex === 0}
              onPress={() => move(selectedIndex, selectedIndex - 1)}
            />
            <ListItem
              icon={ArrowDown}
              title="Move down"
              disabled={selectedIndex === files.length - 1}
              onPress={() => move(selectedIndex, selectedIndex + 1)}
            />
            <ListItem
              icon={RefreshCw}
              title="Replace"
              subtitle="Choose another photo or PDF"
              onPress={() => replace(selected)}
            />
            <ListItem
              icon={Trash2}
              title="Remove"
              titleColor="danger"
              onPress={() => remove(selected)}
            />
          </>
        )}
      </Sheet>
    </FieldGroup>
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
  flex: { flex: 1 },
  fileText: { flex: 1, gap: spacing.xxs },
  photoSlot: { flex: 1, gap: spacing.xs },
  photoActions: { flexDirection: 'row', justifyContent: 'space-between' },
});

const createThemedStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 56,
      paddingLeft: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  });
