import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ListItem, Sheet } from '../../components';
import { categories, ItemType, itemTypes } from '../../data';

const descriptions: Record<ItemType, string> = {
  note: 'Text, lists and ideas',
  reminder: 'Something to do at a set time',
  card: 'Loyalty or membership card',
  document: 'Receipt, warranty or file',
};

interface NewItemSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Type picker shown by the Home "+" button. */
export function NewItemSheet({ visible, onClose }: NewItemSheetProps) {
  const navigation = useNavigation();

  const create = (type: ItemType) => {
    onClose();
    navigation.navigate('ItemEditor', { type });
  };

  return (
    <Sheet visible={visible} title="Add new" onClose={onClose}>
      {itemTypes.map(type => (
        <ListItem
          key={type}
          icon={categories[type].icon}
          title={categories[type].singular}
          subtitle={descriptions[type]}
          onPress={() => create(type)}
        />
      ))}
    </Sheet>
  );
}
