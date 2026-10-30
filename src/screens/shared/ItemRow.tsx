import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Circle, CircleCheck, Pin } from 'lucide-react-native';
import { Icon, ListItem, Text } from '../../components';
import {
  categories,
  documentKinds,
  formatRelative,
  isOverdue,
  Item,
  itemSummary,
  Reminder,
  useItems,
} from '../../data';
import { minTouchTarget, Theme, useStyles } from '../../theme';

interface ItemRowProps {
  item: Item;
  /**
   * `category` — inside a single-category list, the type is implied.
   * `mixed` — Home and Search, where each row shows its type icon.
   */
  context: 'category' | 'mixed';
}

/** Renders any item as a list row, with type-appropriate leading content. */
export function ItemRow({ item, context }: ItemRowProps) {
  const navigation = useNavigation();
  const open = () => navigation.navigate('ItemDetail', { id: item.id });
  const summary = itemSummary(item);
  const pinIndicator =
    context === 'category' && item.pinned ? (
      <Icon icon={Pin} size="sm" color="textTertiary" />
    ) : undefined;

  switch (item.type) {
    case 'note':
      return (
        <ListItem
          title={item.title}
          subtitle={summary}
          subtitleLines={context === 'category' ? 2 : 1}
          icon={context === 'mixed' ? categories.note.icon : undefined}
          meta={formatRelative(item.updatedAt)}
          trailing={pinIndicator}
          onPress={open}
        />
      );
    case 'reminder':
      return <ReminderRow reminder={item} summary={summary} onPress={open} />;
    case 'card':
      return (
        <ListItem
          title={item.title}
          subtitle={summary}
          leading={
            context === 'category' ? <Monogram name={item.title} /> : undefined
          }
          icon={categories.card.icon}
          trailing={pinIndicator}
          onPress={open}
        />
      );
    case 'document':
      return (
        <ListItem
          title={item.title}
          subtitle={summary}
          icon={documentKinds[item.kind].icon}
          trailing={pinIndicator}
          onPress={open}
        />
      );
  }
}

function ReminderRow({
  reminder,
  summary,
  onPress,
}: {
  reminder: Reminder;
  summary: string;
  onPress: () => void;
}) {
  const styles = useStyles(createStyles);
  const { setReminderCompleted } = useItems();
  const overdue = isOverdue(reminder);

  return (
    <ListItem
      title={reminder.title}
      titleColor={reminder.completed ? 'textTertiary' : 'text'}
      subtitle={overdue ? `Overdue · ${summary}` : summary}
      subtitleColor={overdue ? 'danger' : 'textSecondary'}
      leading={
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: reminder.completed }}
          accessibilityLabel={
            reminder.completed ? 'Mark as not done' : 'Mark as done'
          }
          onPress={() => setReminderCompleted(reminder.id, !reminder.completed)}
          style={styles.check}
        >
          <Icon
            icon={reminder.completed ? CircleCheck : Circle}
            size="lg"
            color={reminder.completed ? 'accent' : 'textTertiary'}
          />
        </Pressable>
      }
      onPress={onPress}
    />
  );
}

/** First letter of a card name, so cards are recognisable at a glance. */
function Monogram({ name }: { name: string }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.monogram}>
      <Text variant="headline" color="textSecondary">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

const createStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    check: {
      width: 40,
      height: minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogram: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
