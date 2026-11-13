import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BarHeader, Screen } from '../components';
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { useStorage } from '../storage/StorageProvider';
import { styles } from './backup/parts';
import { RestoreFlow } from './backup/RestoreFlow';

type Props = NativeStackScreenProps<RootStackParamList, 'Restore'>;

/** Settings → Restore from a backup (spec v2.4 §8.1), with the live database open. */
export function RestoreScreen({ navigation }: Props) {
  const { state } = useStorage();
  const t = useStrings();
  const [busy, setBusy] = useState(false);

  // While restoring the gates are held, and from the swap on the old UI
  // must never come back (§8.2, L1).
  usePreventRemove(busy, () => undefined);

  return (
    <Screen
      header={
        <BarHeader
          title={t.restore.title}
          onBack={busy ? undefined : navigation.goBack}
        />
      }
      keyboardAware
    >
      <View style={styles.body}>
        <RestoreFlow
          database={
            state.status === 'ready' ? state.storage.database : undefined
          }
          fromErrorScreen={false}
          onBusyChange={setBusy}
          onClose={navigation.goBack}
        />
      </View>
    </Screen>
  );
}
