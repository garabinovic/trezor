import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ListItem, Sheet } from '../../components';
import { categories, ItemType, itemTypes } from '../../data';
import { useStrings } from '../../i18n';

interface NewItemSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Type picker shown by the Home "+" button. */
export function NewItemSheet({ visible, onClose }: NewItemSheetProps) {
  const navigation = useNavigation();
  const t = useStrings();

  const create = (type: ItemType) => {
    onClose();
    navigation.navigate('ItemEditor', { type });
  };

  return (
    <Sheet visible={visible} title={t.home.addNew} onClose={onClose}>
      {itemTypes.map(type => (
        <ListItem
          key={type}
          icon={categories[type].icon}
          title={t.categories[type].singular}
          subtitle={t.categories[type].description}
          onPress={() => create(type)}
        />
      ))}
    </Sheet>
  );
}
