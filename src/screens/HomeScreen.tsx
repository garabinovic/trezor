import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import {
  Divider,
  Fab,
  fabClearance,
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
  useItems,
} from '../data';
import { buildHomeOverview, COMING_UP_LIMIT } from '../data/organizer';
import { useStrings } from '../i18n';
import { tabForType } from '../navigation/types';
import { gutter, Theme, useStyles } from '../theme';
import { HeaderActions } from './shared/HeaderActions';
import { ItemRow } from './shared/ItemRow';
import { NewItemSheet } from './shared/NewItemSheet';

export function HomeScreen() {
  const styles = useStyles(createStyles);
  const t = useStrings();
  const navigation = useNavigation();
  const { items } = useItems();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { counts, comingUp, pinned, recent } = useMemo(
    () => buildHomeOverview(items),
    [items],
  );

  // Landscape has little height: Search moves into the header, as on the other
  // tabs, and the list gets the room the bottom field took.
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const openTab = (type: ItemType) =>
    navigation.navigate('Tabs', { screen: tabForType[type] });

  return (
    <Screen
      bottomInset={false}
      // Fixed: the title and date stay, only the content scrolls.
      header={
        <LargeHeader
          title={t.home.title}
          subtitle={formatLongToday()}
          actions={<HeaderActions search={landscape} />}
        />
      }
      // Portrait: fixed at the bottom, within thumb reach, directly above Add.
      footer={
        landscape ? undefined : (
          <View style={styles.search}>
            <SearchField
              placeholder={t.home.searchPlaceholder}
              onPress={() => navigation.navigate('Search')}
            />
          </View>
        )
      }
      overlay={<Fab label={t.home.addNew} onPress={() => setSheetOpen(true)} />}
    >
      <View style={styles.overview}>
        {itemTypes.map((type, index) => (
          <React.Fragment key={type}>
            {index > 0 && <View style={styles.overviewDivider} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.home.countAccessibility(
                t.categories[type].plural,
                counts[type],
              )}
              onPress={() => openTab(type)}
              style={({ pressed }) => [
                styles.overviewCell,
                pressed && styles.pressed,
              ]}
            >
              <Icon icon={categories[type].icon} size="md" />
              <Text variant="headline">{counts[type]}</Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {t.categories[type].plural}
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
              title={t.home.comingUp}
              actionLabel={
                comingUp.length > COMING_UP_LIMIT ? t.home.seeAll : undefined
              }
              onActionPress={() => openTab('reminder')}
            >
              <ItemList items={comingUp.slice(0, COMING_UP_LIMIT)} />
            </Section>
          )}
          {pinned.length > 0 && (
            <Section title={t.home.pinned}>
              <ItemList items={pinned} />
            </Section>
          )}
          {recent.length > 0 && (
            <Section title={t.home.recent}>
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

/** First-launch content, shown until something has been added. */
function Welcome({ onCreate }: { onCreate: (type: ItemType) => void }) {
  const styles = useStyles(createStyles);
  const t = useStrings();
  return (
    <View style={styles.sections}>
      <View style={styles.welcome}>
        <Text variant="title">{t.home.welcomeTitle}</Text>
        <Text color="textSecondary">{t.home.welcomeMessage}</Text>
        <View style={styles.privacy}>
          <Icon icon={Lock} size="sm" color="accent" />
          <Text variant="callout" color="textSecondary" style={styles.flex}>
            {t.home.welcomePrivacy}
          </Text>
        </View>
      </View>
      <Section title={t.home.getStarted} grouped dividerInset={0}>
        {itemTypes.map(type => (
          <ListItem
            key={type}
            icon={categories[type].icon}
            title={t.categories[type].starter}
            chevron
            onPress={() => onCreate(type)}
          />
        ))}
      </Section>
    </View>
  );
}

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    search: { marginBottom: fabClearance },
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
