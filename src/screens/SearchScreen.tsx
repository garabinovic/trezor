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
import { categories, itemTypes, useItemSearch } from '../data';
import { RootStackParamList } from '../navigation/types';
import { gutter, spacing, useTheme } from '../theme';
import { ItemRow } from './shared/ItemRow';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

export function SearchScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const search = useItemSearch(query);

  const sections = useMemo(() => {
    if (search.status !== 'done' && search.status !== 'searching') {
      return [];
    }
    return itemTypes
      .map(type => ({
        title: categories[type].plural,
        data: search.results.filter(i => i.type === type),
      }))
      .filter(section => section.data.length > 0);
  }, [search]);

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
      {search.status === 'idle' ? (
        <EmptyState
          icon={Search}
          title="Search everything"
          message="Find notes, reminders, cards and documents by title or content."
        />
      ) : search.status === 'error' ? (
        <EmptyState
          icon={SearchX}
          title="Search isn’t available"
          message="Your items couldn’t be searched right now. Please try again."
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
            search.status === 'done' ? (
              <EmptyState
                icon={SearchX}
                title="No results"
                message={`Nothing matches “${query.trim()}”.`}
              />
            ) : undefined
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
