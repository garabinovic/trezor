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

interface CategoryMeta {
  /** Singular, for "New note", "Delete note?" */
  singular: string;
  /** Plural, for titles and tabs. */
  plural: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyMessage: string;
}

export const categories: Record<ItemType, CategoryMeta> = {
  note: {
    singular: 'Note',
    plural: 'Notes',
    icon: NotebookPen,
    emptyTitle: 'No notes yet',
    emptyMessage: 'Write down ideas, lists and anything you want to remember.',
  },
  reminder: {
    singular: 'Reminder',
    plural: 'Reminders',
    icon: Bell,
    emptyTitle: 'No reminders yet',
    emptyMessage: 'Add reminders for renewals, appointments and small tasks.',
  },
  card: {
    singular: 'Card',
    plural: 'Cards',
    icon: CreditCard,
    emptyTitle: 'No cards yet',
    emptyMessage: 'Keep your loyalty and membership cards ready at checkout.',
  },
  document: {
    singular: 'Document',
    plural: 'Documents',
    icon: Folder,
    emptyTitle: 'No documents yet',
    emptyMessage:
      'Store receipts, warranties and important papers in one place.',
  },
};

export const itemTypes: ItemType[] = ['note', 'reminder', 'card', 'document'];

export const documentKinds: Record<
  DocumentKind,
  { label: string; icon: LucideIcon }
> = {
  receipt: { label: 'Receipt', icon: Receipt },
  warranty: { label: 'Warranty', icon: ShieldCheck },
  image: { label: 'Image', icon: Image },
  document: { label: 'Document', icon: FileText },
};
