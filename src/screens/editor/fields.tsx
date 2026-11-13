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
  formatTime,
  parseIsoDate,
  Reminder,
  ReminderRepeat,
  toIsoDate,
} from '../../data';
import { useStrings } from '../../i18n';
import { strings } from '../../i18n/strings';
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
  const t = useStrings().editor;
  return (
    <>
      <TextField
        label={t.title}
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder={t.noteTitlePlaceholder}
        error={errors.title}
        autoFocus={!draft.title}
        returnKeyType="next"
      />
      <TextField
        label={t.note}
        value={draft.body}
        onChangeText={body => onChange({ body })}
        placeholder={t.noteBodyPlaceholder}
        multiline
      />
    </>
  );
}

const REPEATS: ReminderRepeat[] = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'interval',
];

const DEFAULT_INTERVAL = 240;

/** One plain sentence describing when notifications will come. */
export function scheduleHint(reminder: Reminder): string {
  const t = strings();
  const hint = t.editor.hint;
  const due = new Date(reminder.dueAt);
  const time = formatTime(due);
  const day = due.getDate();
  switch (reminder.repeat) {
    case 'once':
      return hint.once;
    case 'daily':
      return hint.daily(time);
    case 'weekly':
      return hint.weekly(due.getDay(), time);
    case 'monthly':
      return hint.monthly(day, time) + (day > 28 ? hint.monthlyShort : '');
    case 'yearly':
      return (
        hint.yearly(t.dates.dayMonth(day, due.getMonth()), time) +
        (due.getMonth() === 1 && day === 29 ? hint.leapDay : '')
      );
    case 'interval':
      return hint.interval(
        intervalLabel(reminder.intervalMinutes ?? DEFAULT_INTERVAL),
      );
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
  const t = useStrings().editor;
  const due = new Date(draft.dueAt);
  const repeatOptions: ChipOption<ReminderRepeat>[] = REPEATS.map(value => ({
    value,
    label: t.repeatOptions[value],
  }));
  const intervalOptions: ChipOption<string>[] = INTERVAL_PRESETS.map(m => ({
    value: String(m),
    label: t.hours(m / 60),
  }));

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
        label={t.title}
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder={t.reminderTitlePlaceholder}
        error={errors.title}
        autoFocus={!draft.title}
      />
      <View style={styles.row}>
        <DateField
          label={t.date}
          value={due}
          onChange={setDate}
          error={errors.dueAt}
        />
        <DateField label={t.time} mode="time" value={due} onChange={setTime} />
      </View>
      <FieldGroup label={t.repeat}>
        <ChipGroup
          label={t.repeat}
          options={repeatOptions}
          value={draft.repeat}
          onChange={setRepeat}
          inset={false}
        />
      </FieldGroup>
      {draft.repeat === 'interval' && (
        <FieldGroup label={t.every}>
          <ChipGroup
            label={t.interval}
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
        label={t.notes}
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder={t.optional}
        multiline
      />
      {!onTime && (
        <Text variant="caption" color="textTertiary">
          {t.batteryNote}
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
  const t = useStrings().editor;
  return (
    <>
      <TextField
        label={t.cardName}
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder={t.cardNamePlaceholder}
        error={errors.title}
        autoFocus={!draft.title}
      />
      <TextField
        label={t.issuer}
        value={draft.issuer}
        onChangeText={issuer => onChange({ issuer })}
        placeholder={t.issuerPlaceholder}
        autoCapitalize="words"
      />
      <TextField
        label={t.cardNumber}
        value={draft.cardNumber}
        onChangeText={cardNumber => onChange({ cardNumber })}
        placeholder={t.cardNumberPlaceholder}
        error={errors.cardNumber}
        helper={t.cardNumberHelper}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <CardPhotos
        draft={draft}
        onChange={onChange}
        session={attachmentSession}
      />
      <TextField
        label={t.cardholder}
        value={draft.holderName}
        onChangeText={holderName => onChange({ holderName })}
        placeholder={t.optional}
        autoCapitalize="words"
      />
      <TextField
        label={t.notes}
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder={t.optional}
        multiline
      />
    </>
  );
}

type CardSide = 'frontImage' | 'backImage';

function CardPhotos({
  draft,
  onChange,
  session,
}: {
  draft: LoyaltyCard;
  onChange: (patch: Partial<LoyaltyCard>) => void;
  session: AttachmentSession;
}) {
  const t = useStrings().editor;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sides = {
    frontImage: {
      title: t.front,
      photo: t.frontPhoto,
      add: t.addFront,
      addPhoto: t.addFrontPhoto,
      replace: t.replaceFrontPhoto,
      remove: t.removeFrontPhoto,
    },
    backImage: {
      title: t.back,
      photo: t.backPhoto,
      add: t.addBack,
      addPhoto: t.addBackPhoto,
      replace: t.replaceBackPhoto,
      remove: t.removeBackPhoto,
    },
  };

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
    <FieldGroup label={t.cardPhotos}>
      <View style={styles.row}>
        {(['frontImage', 'backImage'] as const).map(side => {
          const photo = draft[side];
          const text = sides[side];
          return (
            <View key={side} style={styles.photoSlot}>
              <Text variant="caption" color="textSecondary">
                {text.title}
              </Text>
              {photo ? (
                <>
                  <AttachmentImage attachment={photo} label={text.photo} />
                  <View style={styles.photoActions}>
                    <Button
                      label={t.replace}
                      accessibilityLabel={text.replace}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onPress={() => pick(side)}
                    />
                    <Button
                      label={t.remove}
                      accessibilityLabel={text.remove}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onPress={() => remove(side)}
                    />
                  </View>
                </>
              ) : (
                <Button
                  label={text.add}
                  accessibilityLabel={text.addPhoto}
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
      {busy && (
        <Text variant="caption" color="textSecondary">
          {t.addingPhoto}
        </Text>
      )}
      {problem && (
        <Text variant="caption" color="danger">
          {problem}
        </Text>
      )}
      <Text variant="caption" color="textTertiary">
        {t.photosNote}
      </Text>
    </FieldGroup>
  );
}

const KINDS = Object.keys(documentKinds) as DocumentKind[];

function isoToDate(value: string | null): Date | null {
  return value ? parseIsoDate(value) : null;
}

export function DocumentFields({
  draft,
  onChange,
  errors,
  attachmentSession,
}: FieldsProps<'document'> & { attachmentSession: AttachmentSession }) {
  const all = useStrings();
  const t = all.editor;
  const kindOptions: ChipOption<DocumentKind>[] = KINDS.map(value => ({
    value,
    label: all.documentKinds[value],
  }));
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
      <FieldGroup label={t.type}>
        <ChipGroup
          label={t.documentType}
          options={kindOptions}
          value={draft.kind}
          onChange={kind => onChange({ kind })}
          inset={false}
        />
      </FieldGroup>
      <TextField
        label={t.title}
        value={draft.title}
        onChangeText={title => onChange({ title })}
        placeholder={
          purchase ? t.purchaseTitlePlaceholder : t.documentTitlePlaceholder
        }
        error={errors.title}
        autoFocus={!draft.title}
      />
      <TextField
        label={t.storeOrIssuer}
        value={draft.merchant}
        onChangeText={merchant => onChange({ merchant })}
        placeholder={t.optional}
      />
      <DateField
        label={purchase ? t.purchaseDate : t.issueDate}
        value={isoToDate(draft.date)}
        onChange={d => onChange({ date: d ? toIsoDate(d) : null })}
        clearable
      />
      <DateField
        label={draft.kind === 'warranty' ? t.warrantyUntil : t.expiresOn}
        value={isoToDate(draft.expiresOn)}
        onChange={d => onChange({ expiresOn: d ? toIsoDate(d) : null })}
        error={errors.expiresOn}
        clearable
      />
      {purchase && (
        <View style={styles.row}>
          <View style={styles.amount}>
            <TextField
              label={t.amount}
              value={amountText}
              onChangeText={changeAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              error={errors.amount}
            />
          </View>
          <View style={styles.currency}>
            <TextField
              label={t.currency}
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
        label={t.notes}
        value={draft.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder={t.optional}
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
  const t = useStrings().editor;
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
    <FieldGroup label={t.attachments}>
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
            label={t.fileOptions(a.fileName)}
            color="textSecondary"
            onPress={() => !busy && setSelectedId(a.id)}
          />
        </View>
      ))}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            label={t.addPhotos}
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
            label={t.addFiles}
            icon={FilePlus}
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy || remaining <= 0}
            onPress={() => add('files')}
          />
        </View>
      </View>
      {busy && (
        <Text variant="caption" color="textSecondary">
          {t.addingFiles}
        </Text>
      )}
      {[...(error ? [error] : []), ...problems].map(text => (
        <Text key={text} variant="caption" color="danger">
          {text}
        </Text>
      ))}
      <Text variant="caption" color="textTertiary">
        {remaining > 0
          ? t.attachmentsNote(MAX_DOCUMENT_ATTACHMENTS)
          : t.attachmentsFull(MAX_DOCUMENT_ATTACHMENTS)}
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
              title={t.moveUp}
              disabled={selectedIndex === 0}
              onPress={() => move(selectedIndex, selectedIndex - 1)}
            />
            <ListItem
              icon={ArrowDown}
              title={t.moveDown}
              disabled={selectedIndex === files.length - 1}
              onPress={() => move(selectedIndex, selectedIndex + 1)}
            />
            <ListItem
              icon={RefreshCw}
              title={t.replace}
              subtitle={t.replaceSubtitle}
              onPress={() => replace(selected)}
            />
            <ListItem
              icon={Trash2}
              title={t.remove}
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
