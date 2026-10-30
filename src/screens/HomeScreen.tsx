import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import {
  Divider,
  Fab,
  Icon,
  LargeHeader,
  ListItem,
  Screen,
  SearchField,
  Section,
  Text,
} from '../components';
import {
  categories,
  formatLongToday,
  Item,
  ItemType,
  itemTypes,
  Reminder,
  useItems,
} from '../data';
import { tabForType } from '../navigation/types';
import { gutter, Theme, useStyles } from '../theme';
import { HeaderActions } from './shared/HeaderActions';
import { ItemRow } from './shared/ItemRow';
import { NewItemSheet } from './shared/NewItemSheet';

const COMING_UP_LIMIT = 3;
const RECENT_LIMIT = 4;

export function HomeScreen() {
  const styles = useStyles(createStyles);
  const navigation = useNavigation();
  const { items } = useItems();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { counts, comingUp, pinned, recent } = useMemo(() => {
    const countsByType = Object.fromEntries(
      itemTypes.map(t => [t, items.filter(i => i.type === t).length]),
    ) as Record<ItemType, number>;
    const openReminders = items
      .filter((i): i is Reminder => i.type === 'reminder' && !i.completed)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    const pinnedItems = items.filter(i => i.pinned);
    const shown = new Set<string>([
      ...openReminders.slice(0, COMING_UP_LIMIT).map(i => i.id),
      ...pinnedItems.map(i => i.id),
    ]);
    const recentItems = items
      .filter(i => !shown.has(i.id) && i.type !== 'reminder')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RECENT_LIMIT);
    return {
      counts: countsByType,
      comingUp: openReminders,
      pinned: pinnedItems,
      recent: recentItems,
    };
  }, [items]);

  const openTab = (type: ItemType) =>
    navigation.navigate('Tabs', { screen: tabForType[type] });

  return (
    <Screen
      bottomInset={false}
      overlay={<Fab label="Add new" onPress={() => setSheetOpen(true)} />}
    >
      <LargeHeader
        title="Trezor"
        eyebrow={formatLongToday()}
        actions={<HeaderActions search={false} />}
      />

      <View style={styles.search}>
        <SearchField
          placeholder="Search everything"
          onPress={() => navigation.navigate('Search')}
        />
      </View>

      <View style={styles.overview}>
        {itemTypes.map((type, index) => (
          <React.Fragment key={type}>
            {index > 0 && <View style={styles.overviewDivider} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${categories[type].plural}, ${counts[type]}`}
              onPress={() => openTab(type)}
              style={({ pressed }) => [
                styles.overviewCell,
                pressed && styles.pressed,
              ]}
            >
              <Icon icon={categories[type].icon} size="md" />
              <Text variant="headline">{counts[type]}</Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {categories[type].plural}
              </Text>
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      {items.length === 0 ? (
        <Welcome
          onCreate={type => navigation.navigate('ItemEditor', { type })}
        />
      ) : (
        <View style={styles.sections}>
          {comingUp.length > 0 && (
            <Section
              title="Coming up"
              actionLabel={
                comingUp.length > COMING_UP_LIMIT ? 'See all' : undefined
              }
              onActionPress={() => openTab('reminder')}
            >
              <ItemList items={comingUp.slice(0, COMING_UP_LIMIT)} />
            </Section>
          )}
          {pinned.length > 0 && (
            <Section title="Pinned">
              <ItemList items={pinned} />
            </Section>
          )}
          {recent.length > 0 && (
            <Section title="Recently updated">
              <ItemList items={recent} />
            </Section>
          )}
        </View>
      )}

      <NewItemSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </Screen>
  );
}

function ItemList({ items }: { items: Item[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {index > 0 && <Divider inset={gutter} />}
          <ItemRow item={item} context="mixed" />
        </React.Fragment>
      ))}
    </View>
  );
}

const starters: { type: ItemType; title: string }[] = [
  { type: 'note', title: 'Write a note' },
  { type: 'reminder', title: 'Add a reminder' },
  { type: 'card', title: 'Add a loyalty card' },
  { type: 'document', title: 'Save a receipt or warranty' },
];

/** First-launch content, shown until something has been added. */
function Welcome({ onCreate }: { onCreate: (type: ItemType) => void }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.sections}>
      <View style={styles.welcome}>
        <Text variant="title">Welcome to Trezor</Text>
        <Text color="textSecondary">
          Keep notes, reminders, loyalty cards and important documents together
          in one private place.
        </Text>
        <View style={styles.privacy}>
          <Icon icon={Lock} size="sm" color="accent" />
          <Text variant="callout" color="textSecondary" style={styles.flex}>
            Everything stays on this device. No account, no ads, no cloud.
          </Text>
        </View>
      </View>
      <Section title="Get started" grouped dividerInset={0}>
        {starters.map(s => (
          <ListItem
            key={s.type}
            icon={categories[s.type].icon}
            title={s.title}
            chevron
            onPress={() => onCreate(s.type)}
          />
        ))}
      </Section>
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    search: { paddingHorizontal: gutter, paddingBottom: spacing.xl },
    overview: {
      flexDirection: 'row',
      marginHorizontal: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    overviewCell: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.lg,
    },
    overviewDivider: {
      width: StyleSheet.hairlineWidth,
      marginVertical: spacing.md,
      backgroundColor: colors.border,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    sections: {
      gap: spacing.xxxl,
      paddingTop: spacing.xxxl,
      paddingBottom: 72,
    },
    welcome: { paddingHorizontal: gutter, gap: spacing.sm },
    privacy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
  });
