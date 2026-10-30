import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Search, Settings } from 'lucide-react-native';
import { IconButton } from '../../components';

/** Search and Settings, shown on every top-level screen. */
export function HeaderActions({ search = true }: { search?: boolean }) {
  const navigation = useNavigation();
  return (
    <>
      {search && (
        <IconButton
          icon={Search}
          label="Search"
          onPress={() => navigation.navigate('Search')}
        />
      )}
      <IconButton
        icon={Settings}
        label="Settings"
        onPress={() => navigation.navigate('Settings')}
      />
    </>
  );
}
