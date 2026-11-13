import {
  Bell,
  CreditCard,
  FileText,
  Folder,
  Image,
  LucideIcon,
  NotebookPen,
  Receipt,
  ShieldCheck,
} from 'lucide-react-native';
import { DocumentKind, ItemType } from './types';

// Icons only: every label is in the app language's strings
// (src/i18n: categories, documentKinds).

export const categories: Record<ItemType, { icon: LucideIcon }> = {
  note: { icon: NotebookPen },
  reminder: { icon: Bell },
  card: { icon: CreditCard },
  document: { icon: Folder },
};

export const itemTypes: ItemType[] = ['note', 'reminder', 'card', 'document'];

export const documentKinds: Record<DocumentKind, { icon: LucideIcon }> = {
  receipt: { icon: Receipt },
  warranty: { icon: ShieldCheck },
  image: { icon: Image },
  document: { icon: FileText },
};
