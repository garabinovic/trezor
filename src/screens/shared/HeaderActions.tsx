import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Search, Settings } from 'lucide-react-native';
import { IconButton } from '../../components';
import { useStrings } from '../../i18n';

/** Search and Settings, shown on every top-level screen. */
export function HeaderActions({ search = true }: { search?: boolean }) {
  const navigation = useNavigation();
  const t = useStrings();
  return (
    <>
      {search && (
        <IconButton
          icon={Search}
          label={t.common.search}
          onPress={() => navigation.navigate('Search')}
        />
      )}
      <IconButton
        icon={Settings}
        label={t.common.settings}
        onPress={() => navigation.navigate('Settings')}
      />
    </>
  );
}
