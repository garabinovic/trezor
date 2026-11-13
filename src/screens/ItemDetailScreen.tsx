import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Calendar,
  FileText,
  Image as ImageIcon,
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
  describeAttachment,
  formatFullDate,
  isImage,
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
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { nextDue } from '../reminders/reminderSchedule';
import { gutter, Theme, useStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetail'>;

export function ItemDetailScreen({ route, navigation }: Props) {
  const styles = useStyles(createStyles);
  const t = useStrings();
  const item = useItem(route.params.id);
  const { deleteItem, togglePinned } = useItems();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!item) {
    return (
      <Screen header={<BarHeader onBack={navigation.goBack} />}>
        <EmptyState
          icon={Trash2}
          title={t.detail.notFoundTitle}
          message={t.detail.notFoundMessage}
        />
      </Screen>
    );
  }

  const text = t.categories[item.type];
  const kind =
    item.type === 'document'
      ? {
          label: t.documentKinds[item.kind],
          icon: documentKinds[item.kind].icon,
        }
      : { label: text.singular, icon: categories[item.type].icon };

  return (
    <Screen
      header={
        <BarHeader
          onBack={navigation.goBack}
          actions={
            <>
              <IconButton
                icon={item.pinned ? PinOff : Pin}
                label={item.pinned ? t.detail.unpin : t.detail.pin}
                onPress={() => togglePinned(item.id)}
              />
              <IconButton
                icon={Pencil}
                label={t.common.edit}
                onPress={() =>
                  navigation.navigate('ItemEditor', {
                    type: item.type,
                    id: item.id,
                  })
                }
              />
              <IconButton
                icon={Trash2}
                label={t.common.delete}
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
            {item.pinned ? t.detail.pinnedSuffix : ''}
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
        title={text.deleteTitle}
        message={t.detail.deleteMessage(item.title)}
        confirmLabel={t.common.delete}
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
  const t = useStrings();
  if (!text) {
    return null;
  }
  return (
    <Section title={t.detail.notes}>
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
  const t = useStrings();
  const { setReminderCompleted } = useItems();
  const overdue = isOverdue(reminder);
  const due = nextDue(reminder);

  return (
    <View style={styles.body}>
      <Section grouped>
        <ValueRow
          icon={Calendar}
          label={reminder.repeat === 'once' ? t.detail.due : t.detail.next}
          value={due === null ? '—' : formatDue(new Date(due).toISOString())}
          valueColor={overdue ? 'danger' : 'text'}
        />
        <ValueRow
          icon={Repeat}
          label={t.detail.repeat}
          value={repeatLabel(reminder)}
        />
      </Section>
      <NotesBlock text={reminder.notes} />
      <View style={styles.actions}>
        <Button
          label={reminder.completed ? t.items.markNotDone : t.items.markDone}
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
  const t = useStrings();
  const navigation = useNavigation();
  const photos = [
    {
      photo: card.frontImage,
      side: t.detail.cardFront,
      open: t.detail.openFrontPhoto,
      label: t.detail.frontPhoto,
    },
    {
      photo: card.backImage,
      side: t.detail.cardBack,
      open: t.detail.openBackPhoto,
      label: t.detail.backPhoto,
    },
  ].filter(p => p.photo !== null);

  return (
    <View style={styles.body}>
      {photos.length > 0 && (
        <View style={styles.photos}>
          {photos.map(({ photo, side, open, label }) => (
            <Pressable
              key={side}
              style={styles.photo}
              accessibilityRole="button"
              accessibilityLabel={open}
              onPress={() =>
                navigation.navigate('AttachmentViewer', {
                  itemId: card.id,
                  attachmentId: photo!.id,
                })
              }
            >
              <AttachmentImage attachment={photo!} label={label} />
              <Text variant="caption" color="textTertiary" align="center">
                {side}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.cardPanel}>
        <Text variant="mono" align="center" selectable>
          {formatCardNumber(card.cardNumber)}
        </Text>
        <Text variant="caption" color="textTertiary" align="center">
          {t.detail.cardNumberCaption}
        </Text>
      </View>
      {(!!card.issuer || !!card.holderName) && (
        <Section grouped>
          {!!card.issuer && (
            <ValueRow
              icon={Store}
              label={t.detail.issuer}
              value={card.issuer}
            />
          )}
          {!!card.holderName && (
            <ValueRow
              icon={User}
              label={t.detail.cardholder}
              value={card.holderName}
            />
          )}
        </Section>
      )}
      <NotesBlock text={card.notes} />
    </View>
  );
}

function DocumentBody({ doc }: { doc: DocumentItem }) {
  const styles = useStyles(createStyles);
  const t = useStrings();
  const navigation = useNavigation();
  const date = doc.date ? parseIsoDate(doc.date) : null;
  const expires = doc.expiresOn ? parseIsoDate(doc.expiresOn) : null;
  const expired = !!expires && expires < new Date();

  return (
    <View style={styles.body}>
      {doc.attachments.length > 0 && (
        <Section
          title={
            doc.attachments.length > 1
              ? t.detail.attachments
              : t.detail.attachment
          }
          grouped
        >
          {doc.attachments.map(a => (
            <ListItem
              key={a.id}
              icon={isImage(a) ? ImageIcon : FileText}
              title={a.fileName}
              subtitle={describeAttachment(a)}
              chevron
              onPress={() =>
                navigation.navigate('AttachmentViewer', {
                  itemId: doc.id,
                  attachmentId: a.id,
                })
              }
            />
          ))}
        </Section>
      )}
      <Section title={t.detail.details} grouped>
        {!!doc.merchant && (
          <ValueRow
            icon={Store}
            label={t.detail.storeOrIssuer}
            value={doc.merchant}
          />
        )}
        {date && (
          <ValueRow
            icon={Calendar}
            label={
              doc.kind === 'receipt' || doc.kind === 'warranty'
                ? t.detail.purchaseDate
                : t.detail.issueDate
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
                  ? t.detail.warrantyEnded
                  : t.detail.warrantyUntil
                : expired
                ? t.detail.expired
                : t.detail.expiresOn
            }
            value={formatFullDate(expires)}
            valueColor={expired ? 'danger' : 'text'}
          />
        )}
        {doc.amount != null && (
          <ValueRow
            icon={Wallet}
            label={t.detail.amount}
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
