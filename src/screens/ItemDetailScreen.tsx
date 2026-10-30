import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Barcode,
  Calendar,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  QrCode,
  Repeat,
  Store,
  Trash2,
  User,
  Wallet,
  CalendarClock,
} from 'lucide-react-native';
import {
  BarHeader,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  ListItem,
  Screen,
  Section,
  Text,
  ValueRow,
} from '../components';
import {
  categories,
  documentKinds,
  DocumentItem,
  formatAmount,
  formatCardNumber,
  formatDue,
  formatFileSize,
  formatFullDate,
  formatEdited,
  isOverdue,
  LoyaltyCard,
  Note,
  parseIsoDate,
  Reminder,
  repeatLabels,
  useItem,
  useItems,
} from '../data';
import { RootStackParamList } from '../navigation/types';
import { gutter, Theme, useStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetail'>;

export function ItemDetailScreen({ route, navigation }: Props) {
  const styles = useStyles(createStyles);
  const item = useItem(route.params.id);
  const { deleteItem, togglePinned } = useItems();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!item) {
    return (
      <Screen header={<BarHeader onBack={navigation.goBack} />}>
        <EmptyState
          icon={Trash2}
          title="Item not found"
          message="It may have been deleted."
        />
      </Screen>
    );
  }

  const meta = categories[item.type];
  const kind =
    item.type === 'document'
      ? documentKinds[item.kind]
      : { label: meta.singular, icon: meta.icon };

  return (
    <Screen
      header={
        <BarHeader
          onBack={navigation.goBack}
          actions={
            <>
              <IconButton
                icon={item.pinned ? PinOff : Pin}
                label={item.pinned ? 'Unpin' : 'Pin to Home'}
                onPress={() => togglePinned(item.id)}
              />
              <IconButton
                icon={Pencil}
                label="Edit"
                onPress={() =>
                  navigation.navigate('ItemEditor', {
                    type: item.type,
                    id: item.id,
                  })
                }
              />
              <IconButton
                icon={Trash2}
                label="Delete"
                onPress={() => setConfirmDelete(true)}
              />
            </>
          }
        />
      }
    >
      <View style={styles.titleBlock}>
        <View style={styles.kind}>
          <Icon icon={kind.icon} size="sm" color="textTertiary" />
          <Text variant="label" color="textTertiary">
            {kind.label}
            {item.pinned ? ' · Pinned' : ''}
          </Text>
        </View>
        <Text variant="title">{item.title}</Text>
        <Text variant="caption" color="textTertiary">
          {formatEdited(item.updatedAt)}
        </Text>
      </View>

      {item.type === 'note' && <NoteBody note={item} />}
      {item.type === 'reminder' && <ReminderBody reminder={item} />}
      {item.type === 'card' && <CardBody card={item} />}
      {item.type === 'document' && <DocumentBody doc={item} />}

      <Dialog
        visible={confirmDelete}
        title={`Delete ${meta.singular.toLowerCase()}?`}
        message={`“${item.title}” will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          navigation.goBack();
          deleteItem(item.id);
        }}
      />
    </Screen>
  );
}

function NotesBlock({ text }: { text: string }) {
  const styles = useStyles(createStyles);
  if (!text) {
    return null;
  }
  return (
    <Section title="Notes">
      <Text style={styles.paragraph} selectable>
        {text}
      </Text>
    </Section>
  );
}

function NoteBody({ note }: { note: Note }) {
  const styles = useStyles(createStyles);
  return (
    <Text style={styles.paragraph} selectable>
      {note.body}
    </Text>
  );
}

function ReminderBody({ reminder }: { reminder: Reminder }) {
  const styles = useStyles(createStyles);
  const { setReminderCompleted } = useItems();
  const overdue = isOverdue(reminder);

  return (
    <View style={styles.body}>
      <Section grouped>
        <ValueRow
          icon={Calendar}
          label="Due"
          value={formatDue(reminder.dueAt)}
          valueColor={overdue ? 'danger' : 'text'}
        />
        <ValueRow
          icon={Repeat}
          label="Repeat"
          value={repeatLabels[reminder.repeat]}
        />
      </Section>
      <NotesBlock text={reminder.notes} />
      <View style={styles.actions}>
        <Button
          label={reminder.completed ? 'Mark as not done' : 'Mark as done'}
          variant={reminder.completed ? 'secondary' : 'primary'}
          fullWidth
          onPress={() => setReminderCompleted(reminder.id, !reminder.completed)}
        />
      </View>
    </View>
  );
}

function CardBody({ card }: { card: LoyaltyCard }) {
  const styles = useStyles(createStyles);
  const formatLabel = card.codeFormat === 'qr' ? 'QR code' : 'Barcode';

  return (
    <View style={styles.body}>
      <View style={styles.cardPanel}>
        <View style={styles.codeArea}>
          <Icon
            icon={card.codeFormat === 'qr' ? QrCode : Barcode}
            size="lg"
            color="textTertiary"
          />
          <Text variant="caption" color="textTertiary" align="center">
            {formatLabel} display is not available yet
          </Text>
        </View>
        <Text variant="mono" align="center" selectable>
          {formatCardNumber(card.cardNumber)}
        </Text>
        <Text variant="caption" color="textTertiary" align="center">
          Card number
        </Text>
      </View>
      <Section grouped>
        {!!card.holderName && (
          <ValueRow icon={User} label="Cardholder" value={card.holderName} />
        )}
        <ValueRow
          icon={card.codeFormat === 'qr' ? QrCode : Barcode}
          label="Code type"
          value={formatLabel}
        />
      </Section>
      <NotesBlock text={card.notes} />
    </View>
  );
}

function DocumentBody({ doc }: { doc: DocumentItem }) {
  const styles = useStyles(createStyles);
  const date = doc.date ? parseIsoDate(doc.date) : null;
  const expires = doc.expiresOn ? parseIsoDate(doc.expiresOn) : null;
  const expired = !!expires && expires < new Date();

  return (
    <View style={styles.body}>
      {doc.attachment && (
        <Section title="Attachment" grouped>
          <ListItem
            icon={Paperclip}
            title={doc.attachment.fileName}
            subtitle={`${formatFileSize(
              doc.attachment.sizeKb,
            )} · Opening files is not available yet`}
            disabled
          />
        </Section>
      )}
      <Section title="Details" grouped>
        {!!doc.merchant && (
          <ValueRow icon={Store} label="Store or issuer" value={doc.merchant} />
        )}
        {date && (
          <ValueRow
            icon={Calendar}
            label={
              doc.kind === 'receipt' || doc.kind === 'warranty'
                ? 'Purchase date'
                : 'Issue date'
            }
            value={formatFullDate(date)}
          />
        )}
        {expires && (
          <ValueRow
            icon={CalendarClock}
            label={
              doc.kind === 'warranty'
                ? expired
                  ? 'Warranty ended'
                  : 'Warranty until'
                : expired
                ? 'Expired'
                : 'Expires on'
            }
            value={formatFullDate(expires)}
            valueColor={expired ? 'danger' : 'text'}
          />
        )}
        {doc.amount != null && (
          <ValueRow
            icon={Wallet}
            label="Amount"
            value={formatAmount(doc.amount, doc.currency)}
          />
        )}
      </Section>
      <NotesBlock text={doc.notes} />
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    titleBlock: {
      paddingHorizontal: gutter,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
      gap: spacing.xs,
    },
    kind: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    body: { gap: spacing.xxl },
    paragraph: { paddingHorizontal: gutter },
    actions: { paddingHorizontal: gutter },
    cardPanel: {
      marginHorizontal: spacing.lg,
      padding: spacing.xl,
      gap: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    codeArea: {
      height: 120,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
  });
