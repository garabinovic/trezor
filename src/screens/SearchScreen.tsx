import React, { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Search, SearchX } from 'lucide-react-native';
import {
  Divider,
  EmptyState,
  IconButton,
  Screen,
  SearchField,
  Text,
} from '../components';
import { categories, Item, itemTypes, useItems } from '../data';
import { RootStackParamList } from '../navigation/types';
import { gutter, spacing, useTheme } from '../theme';
import { ItemRow } from './shared/ItemRow';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

/** Text an item can be found by, beyond its title. */
function searchableText(item: Item): string {
  switch (item.type) {
    case 'note':
      return item.body;
    case 'reminder':
      return item.notes;
    case 'card':
      return `${item.cardNumber} ${item.holderName} ${item.notes}`;
    case 'document':
      return `${item.merchant} ${item.notes} ${
        item.attachment?.fileName ?? ''
      }`;
  }
}

export function SearchScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { items } = useItems();
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!term) {
      return [];
    }
    const matches = items.filter(
      i =>
        i.title.toLowerCase().includes(term) ||
        searchableText(i).toLowerCase().includes(term),
    );
    return itemTypes
      .map(type => ({
        title: categories[type].plural,
        data: matches.filter(i => i.type === type),
      }))
      .filter(section => section.data.length > 0);
  }, [items, term]);

  return (
    <Screen
      scroll={false}
      header={
        <View style={styles.header}>
          <IconButton
            icon={ArrowLeft}
            label="Back"
            onPress={navigation.goBack}
          />
          <View style={styles.field}>
            <SearchField
              placeholder="Search everything"
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
          </View>
        </View>
      }
    >
      {!term ? (
        <EmptyState
          icon={Search}
          title="Search everything"
          message="Find notes, reminders, cards and documents by title or content."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          renderItem={({ item }) => <ItemRow item={item} context="mixed" />}
          renderSectionHeader={({ section }) => (
            <Text
              variant="label"
              color="textSecondary"
              style={[
                styles.sectionHeader,
                { backgroundColor: colors.background },
              ]}
            >
              {section.title}
            </Text>
          )}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState
              icon={SearchX}
              title="No results"
              message={`Nothing matches “${query.trim()}”.`}
            />
          }
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
}

function Separator() {
  return <Divider inset={gutter} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: gutter,
    paddingVertical: spacing.sm,
  },
  field: { flex: 1 },
  sectionHeader: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xs,
  },
  list: { paddingBottom: spacing.huge },
});
