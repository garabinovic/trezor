import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Calendar,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
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
  repeatLabel,
  useItem,
  useItems,
} from '../data';
import { AttachmentImage } from '../attachments/AttachmentImage';
import { RootStackParamList } from '../navigation/types';
import { nextDue } from '../reminders/reminderSchedule';
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
  const due = nextDue(reminder);

  return (
    <View style={styles.body}>
      <Section grouped>
        <ValueRow
          icon={Calendar}
          label={reminder.repeat === 'once' ? 'Due' : 'Next'}
          value={due === null ? '—' : formatDue(new Date(due).toISOString())}
          valueColor={overdue ? 'danger' : 'text'}
        />
        <ValueRow icon={Repeat} label="Repeat" value={repeatLabel(reminder)} />
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
  const photos = [
    { photo: card.frontImage, side: 'Front', name: 'front' },
    { photo: card.backImage, side: 'Back', name: 'back' },
  ].filter(p => p.photo !== null);

  return (
    <View style={styles.body}>
      {photos.length > 0 && (
        <View style={styles.photos}>
          {photos.map(({ photo, side, name }) => (
            <View key={side} style={styles.photo}>
              <AttachmentImage
                attachment={photo!}
                label={`Photo of the ${name} of the card`}
              />
              <Text variant="caption" color="textTertiary" align="center">
                {side}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.cardPanel}>
        <Text variant="mono" align="center" selectable>
          {formatCardNumber(card.cardNumber)}
        </Text>
        <Text variant="caption" color="textTertiary" align="center">
          Card number · No barcode saved
        </Text>
      </View>
      {(!!card.issuer || !!card.holderName) && (
        <Section grouped>
          {!!card.issuer && (
            <ValueRow icon={Store} label="Issuer" value={card.issuer} />
          )}
          {!!card.holderName && (
            <ValueRow icon={User} label="Cardholder" value={card.holderName} />
          )}
        </Section>
      )}
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
      {doc.attachments.length > 0 && (
        <Section
          title={doc.attachments.length > 1 ? 'Attachments' : 'Attachment'}
          grouped
        >
          {doc.attachments.map(a => (
            <ListItem
              key={a.id}
              icon={Paperclip}
              title={a.fileName}
              subtitle={`${formatFileSize(
                a.sizeBytes,
              )} · Opening files is not available yet`}
              disabled
            />
          ))}
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
    photos: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    photo: { flex: 1, gap: spacing.xs },
  });
