import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Download,
  Fingerprint,
  FlaskConical,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react-native';
import {
  BarHeader,
  ChipGroup,
  ChipOption,
  ListItem,
  Screen,
  Section,
  ValueRow,
} from '../components';
import { useItems } from '../data';
import { RootStackParamList } from '../navigation/types';
import {
  spacing,
  ThemePreference,
  useTheme,
  useThemePreference,
} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const themeOptions: ChipOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const NOT_AVAILABLE = 'Not available yet';

export function SettingsScreen({ navigation }: Props) {
  const { colors, scheme } = useTheme();
  const { preference, setPreference } = useThemePreference();
  const { sampleDataEnabled, setSampleDataEnabled } = useItems();

  return (
    <Screen header={<BarHeader title="Settings" onBack={navigation.goBack} />}>
      <View style={styles.sections}>
        <Section title="Appearance">
          <ChipGroup
            label="Theme"
            options={themeOptions}
            value={preference}
            onChange={setPreference}
          />
        </Section>

        <Section
          title="Security"
          grouped
          footer="App lock will protect Trezor with a PIN or your fingerprint."
        >
          <ListItem
            icon={Lock}
            title="App lock"
            subtitle={NOT_AVAILABLE}
            disabled
          />
          <ListItem
            icon={Fingerprint}
            title="Unlock with fingerprint"
            subtitle={NOT_AVAILABLE}
            disabled
          />
        </Section>

        <Section
          title="Data"
          grouped
          footer="Trezor stores everything on this device. There is no account and no cloud sync."
        >
          <ListItem
            icon={Download}
            title="Back up to a file"
            subtitle={NOT_AVAILABLE}
            disabled
          />
          <ListItem
            icon={Upload}
            title="Restore from a backup"
            subtitle={NOT_AVAILABLE}
            disabled
          />
          <ListItem
            icon={Trash2}
            title="Delete all data"
            subtitle={NOT_AVAILABLE}
            disabled
          />
        </Section>

        <Section
          title="Preview"
          grouped
          footer="This is a preview build. Changes you make are kept only until the app is closed."
        >
          <ListItem
            icon={FlaskConical}
            title="Show sample data"
            subtitle="Turn off to see the first-launch experience"
            subtitleLines={2}
            trailing={
              <Switch
                accessibilityLabel="Show sample data"
                value={sampleDataEnabled}
                onValueChange={setSampleDataEnabled}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                thumbColor={scheme === 'dark' ? colors.text : colors.surface}
              />
            }
          />
        </Section>

        <Section title="About" grouped>
          <ValueRow label="Version" value="0.1.0 (preview)" />
          <ListItem
            icon={ShieldCheck}
            title="Private by design"
            subtitle="No ads, no tracking and no account. Your data never leaves this device."
            subtitleLines={3}
          />
        </Section>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { gap: spacing.xxxl, paddingTop: spacing.sm },
});
