import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileX,
  LockKeyhole,
  Share2,
  X,
} from 'lucide-react-native';
import { useAttachmentView } from '../attachments/AttachmentImage';
import { PdfPages, usePdfDocument } from '../attachments/PdfPages';
import {
  AttachmentErrorCode,
  nativeAttachmentPlatform,
  toAttachmentError,
} from '../attachments/platform';
import { ZoomableImage } from '../attachments/ZoomableImage';
import {
  BarHeader,
  Button,
  EmptyState,
  IconButton,
  Screen,
  Text,
} from '../components';
import {
  Attachment,
  describeAttachment,
  isImage,
  Item,
  useItem,
} from '../data';
import { RootStackParamList } from '../navigation/types';
import { gutter, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AttachmentViewer'>;

/** What the viewer can page through for an item, in order. */
export function viewableAttachments(
  item: Item | undefined,
): { attachment: Attachment; title: string }[] {
  if (item?.type === 'card') {
    return [
      ...(item.frontImage
        ? [{ attachment: item.frontImage, title: 'Front of card' }]
        : []),
      ...(item.backImage
        ? [{ attachment: item.backImage, title: 'Back of card' }]
        : []),
    ];
  }
  if (item?.type === 'document') {
    return item.attachments.map(attachment => ({
      attachment,
      title: attachment.fileName,
    }));
  }
  return [];
}

type Problem = AttachmentErrorCode | 'UNDISPLAYABLE';

const problems: Partial<Record<Problem, { title: string; message: string }>> = {
  MISSING: {
    title: 'File is missing',
    message:
      'Its encrypted copy is no longer on this device. You can remove or replace it by editing.',
  },
  DAMAGED: {
    title: 'File is damaged',
    message:
      'It doesn’t match the file that was saved, so it isn’t shown. You can remove or replace it by editing.',
  },
  KEY_UNAVAILABLE: {
    title: 'File can’t be opened',
    message: 'Its encryption key is unavailable on this device.',
  },
  PDF_PROTECTED: {
    title: 'PDF is password-protected',
    message: 'Trezor can’t open PDFs that need a password.',
  },
  PDF_UNSUPPORTED: {
    title: 'PDF can’t be shown',
    message: 'Android can’t display this PDF.',
  },
  UNDISPLAYABLE: {
    title: 'Image can’t be shown',
    message: 'This image format isn’t supported on this version of Android.',
  },
};

function ViewerProblem({ code }: { code: Problem }) {
  const text = problems[code] ?? {
    title: 'File can’t be opened',
    message: 'Something went wrong. Try again.',
  };
  return (
    <View style={styles.centre}>
      <EmptyState
        icon={code === 'PDF_PROTECTED' ? LockKeyhole : FileX}
        title={text.title}
        message={text.message}
      />
    </View>
  );
}

type Action = 'save' | 'share';

/** What to tell the user after Save a copy or Share; null for nothing. */
export function actionMessage(
  action: Action,
  code: AttachmentErrorCode,
): string | null {
  const done = action === 'save' ? 'saved' : 'shared';
  switch (code) {
    case 'BUSY':
      return null;
    case 'MISSING':
      return `The file is missing and can’t be ${done}.`;
    case 'DAMAGED':
      return `The file is damaged and can’t be ${done}.`;
    case 'KEY_UNAVAILABLE':
      return `The file can’t be ${done}: its encryption key is unavailable.`;
    case 'DESTINATION_NOT_EMPTY':
      return 'That file already exists and was left unchanged. Choose a new name.';
    case 'EXPORT_FAILED':
      return 'The copy couldn’t be saved. The incomplete copy was removed.';
    case 'EXPORT_INCOMPLETE':
      return 'The copy couldn’t be saved. An incomplete file may remain where you chose to save it.';
    case 'PICKER_UNAVAILABLE':
      return 'No app on this device can save files.';
    case 'SHARE_UNAVAILABLE':
      return 'No app on this device can receive this file.';
    default:
      return `The file couldn’t be ${done}. Try again.`;
  }
}

/**
 * Save a copy (Android's "save to" picker) and Share (the system share sheet)
 * for the file being viewed. Both run natively on a checked copy; the stored
 * encrypted file is only read.
 */
function FileActions({ attachment }: { attachment: Attachment }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  const run = async (action: Action) => {
    setStatus(null);
    setBusy(true);
    try {
      if (action === 'save') {
        const result = await nativeAttachmentPlatform.saveCopy(attachment);
        if (result === 'saved') {
          setStatus({ text: 'Copy saved.', error: false });
        }
      } else {
        await nativeAttachmentPlatform.share(attachment);
      }
    } catch (e) {
      const text = actionMessage(action, toAttachmentError(e).code);
      setStatus(text ? { text, error: true } : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.actions}>
      {status && (
        <Text
          variant="caption"
          color={status.error ? 'danger' : 'textSecondary'}
          align="center"
        >
          {status.text}
        </Text>
      )}
      <View style={styles.actionRow}>
        <View style={styles.fill}>
          <Button
            label="Save a copy"
            icon={Download}
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={() => run('save')}
          />
        </View>
        <View style={styles.fill}>
          <Button
            label="Share"
            icon={Share2}
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={() => run('share')}
          />
        </View>
      </View>
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.centre}>
      <Text variant="callout" color="textTertiary" align="center">
        Opening…
      </Text>
    </View>
  );
}

/**
 * Full-screen viewer for an item's photos and PDFs. Each file is a checked,
 * decrypted copy in the private cache while it is shown; switching files or
 * leaving the viewer deletes it. Save a copy and Share act on the file shown.
 */
export function AttachmentViewerScreen({ route, navigation }: Props) {
  const item = useItem(route.params.itemId);
  const files = viewableAttachments(item);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      files.findIndex(f => f.attachment.id === route.params.attachmentId),
    ),
  );
  const [page, setPage] = useState<{ index: number; count: number } | null>(
    null,
  );
  const current = files[Math.min(index, files.length - 1)];

  const go = (next: number) => {
    setPage(null);
    setIndex(next);
  };

  const position = [
    files.length > 1 ? `${index + 1} of ${files.length}` : null,
    current ? describeAttachment(current.attachment) : null,
    page && page.count > 1 ? `Page ${page.index + 1} of ${page.count}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen
      scroll={false}
      header={
        <BarHeader
          title={current?.title ?? ''}
          onBack={navigation.goBack}
          backIcon={X}
          backLabel="Close"
          actions={
            files.length > 1 && (
              <>
                <IconButton
                  icon={ChevronLeft}
                  label="Previous file"
                  color={index > 0 ? 'text' : 'textTertiary'}
                  onPress={() => index > 0 && go(index - 1)}
                />
                <IconButton
                  icon={ChevronRight}
                  label="Next file"
                  color={index < files.length - 1 ? 'text' : 'textTertiary'}
                  onPress={() => index < files.length - 1 && go(index + 1)}
                />
              </>
            )
          }
        />
      }
    >
      {current ? (
        <>
          {!!position && (
            <Text
              variant="caption"
              color="textSecondary"
              style={styles.position}
            >
              {position}
            </Text>
          )}
          {/* Keyed by id: a different file unmounts the previous one's copy. */}
          {isImage(current.attachment) ? (
            <ImageView key={current.attachment.id} file={current} />
          ) : (
            <PdfView
              key={current.attachment.id}
              attachment={current.attachment}
              onPage={setPage}
            />
          )}
          <FileActions
            key={`actions-${current.attachment.id}`}
            attachment={current.attachment}
          />
        </>
      ) : (
        <View style={styles.centre}>
          <EmptyState
            icon={FileX}
            title="File not found"
            message="It may have been removed."
          />
        </View>
      )}
    </Screen>
  );
}

function ImageView({
  file,
}: {
  file: { attachment: Attachment; title: string };
}) {
  const view = useAttachmentView(file.attachment);
  const [undisplayable, setUndisplayable] = useState(false);
  if (view.status === 'loading') {
    return <Loading />;
  }
  if (view.status === 'error') {
    return <ViewerProblem code={view.code} />;
  }
  if (undisplayable) {
    return <ViewerProblem code="UNDISPLAYABLE" />;
  }
  return (
    <ZoomableImage
      uri={view.uri}
      label={file.title}
      onError={() => setUndisplayable(true)}
    />
  );
}

function PdfView({
  attachment,
  onPage,
}: {
  attachment: Attachment;
  onPage: (page: { index: number; count: number }) => void;
}) {
  const pdf = usePdfDocument(attachment);
  const [width, setWidth] = useState(0);
  const count = pdf.status === 'ready' ? pdf.pdf.pages.length : 0;
  useEffect(() => {
    if (count > 0) {
      onPage({ index: 0, count });
    }
  }, [count, onPage]);
  if (pdf.status === 'loading') {
    return <Loading />;
  }
  if (pdf.status === 'error') {
    return <ViewerProblem code={pdf.code} />;
  }
  return (
    <View
      testID="pdf-viewer"
      style={styles.fill}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <PdfPages
          pdf={pdf.pdf}
          width={width}
          onPageChange={i => onPage({ index: i, count })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center' },
  position: { paddingHorizontal: gutter, paddingBottom: spacing.sm },
  actions: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  actionRow: { flexDirection: 'row', gap: spacing.md },
});
