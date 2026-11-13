import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  ChipGroup,
  Divider,
  EmptyState,
  Fab,
  LargeHeader,
  Screen,
} from '../../components';
import { categories, ItemOfType, ItemType, useItemsOfType } from '../../data';
import { ItemFilter } from '../../data/organizer';
import { useLanguage, useStrings } from '../../i18n';
import { spacing } from '../../theme';
import { HeaderActions } from './HeaderActions';
import { ItemRow } from './ItemRow';

export type CategoryFilter<T extends ItemType> = ItemFilter<T>;

interface CategoryScreenProps<T extends ItemType> {
  type: T;
  sort: (a: ItemOfType<T>, b: ItemOfType<T>) => number;
  filters?: CategoryFilter<T>[];
  /** Overrides the count line under the title. */
  countLabel?: (items: ItemOfType<T>[]) => string;
}

/** Shared template for the Notes, Reminders, Cards and Documents tabs. */
export function CategoryScreen<T extends ItemType>({
  type,
  sort,
  filters,
  countLabel,
}: CategoryScreenProps<T>) {
  const navigation = useNavigation();
  const t = useStrings();
  const { language } = useLanguage();
  const meta = categories[type];
  const text = t.categories[type];
  const all = useItemsOfType(type);
  const [filterValue, setFilterValue] = useState(filters?.[0].value ?? '');
  const filter = filters?.find(f => f.value === filterValue);

  const visible = useMemo(
    () => (filter ? all.filter(filter.predicate) : [...all]).sort(sort),
    [all, filter, sort],
  );

  const create = () => navigation.navigate('ItemEditor', { type });
  const countText = countLabel ? countLabel(all) : t.counts.items(all.length);
  const chips = useMemo(
    () => filters?.map(f => ({ value: f.value, label: t.filters[f.label] })),
    [filters, t],
  );

  return (
    <Screen
      scroll={false}
      bottomInset={false}
      header={
        <LargeHeader
          title={text.plural}
          subtitle={all.length > 0 ? countText : undefined}
          actions={<HeaderActions />}
        />
      }
      overlay={<Fab label={text.newTitle} onPress={create} />}
    >
      {all.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title={text.emptyTitle}
          message={text.emptyMessage}
          actionLabel={text.add}
          onActionPress={create}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ItemRow item={item} context="category" />}
          // Rows show dates and labels in the app language.
          extraData={language}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={
            chips ? (
              <View style={styles.filters}>
                <ChipGroup
                  label={text.filterLabel}
                  options={chips}
                  value={filterValue}
                  onChange={setFilterValue}
                />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              icon={meta.icon}
              title={t.filters.nothingHere}
              message={
                filter?.emptyMessage
                  ? t.filters[filter.emptyMessage]
                  : undefined
              }
            />
          }
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
}

function Separator() {
  return <Divider inset={spacing.xl} />;
}

const styles = StyleSheet.create({
  filters: { paddingBottom: spacing.sm },
  // Leaves room for the FAB over the last row.
  list: { paddingBottom: 96 },
});
