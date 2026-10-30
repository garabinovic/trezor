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
  const meta = categories[type];
  const all = useItemsOfType(type);
  const [filterValue, setFilterValue] = useState(filters?.[0].value ?? '');
  const filter = filters?.find(f => f.value === filterValue);

  const visible = useMemo(
    () => (filter ? all.filter(filter.predicate) : [...all]).sort(sort),
    [all, filter, sort],
  );

  const create = () => navigation.navigate('ItemEditor', { type });
  const eyebrow = countLabel
    ? countLabel(all)
    : `${all.length} ${all.length === 1 ? 'item' : 'items'}`;

  return (
    <Screen
      scroll={false}
      bottomInset={false}
      header={
        <LargeHeader
          title={meta.plural}
          eyebrow={all.length > 0 ? eyebrow : undefined}
          actions={<HeaderActions />}
        />
      }
      overlay={
        <Fab label={`New ${meta.singular.toLowerCase()}`} onPress={create} />
      }
    >
      {all.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title={meta.emptyTitle}
          message={meta.emptyMessage}
          actionLabel={`Add ${meta.singular.toLowerCase()}`}
          onActionPress={create}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ItemRow item={item} context="category" />}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={
            filters ? (
              <View style={styles.filters}>
                <ChipGroup
                  label={`Filter ${meta.plural.toLowerCase()}`}
                  options={filters}
                  value={filterValue}
                  onChange={setFilterValue}
                />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              icon={meta.icon}
              title="Nothing here"
              message={filter?.emptyMessage}
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
