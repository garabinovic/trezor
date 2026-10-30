import { NavigatorScreenParams } from '@react-navigation/native';
import { ItemType } from '../data';

export type TabParamList = {
  Home: undefined;
  Notes: undefined;
  Reminders: undefined;
  Cards: undefined;
  Documents: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  ItemDetail: { id: string };
  ItemEditor: { type: ItemType; id?: string };
  Search: undefined;
  Settings: undefined;
};

export const tabForType: Record<ItemType, keyof TabParamList> = {
  note: 'Notes',
  reminder: 'Reminders',
  card: 'Cards',
  document: 'Documents',
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
