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
import { useStrings } from '../i18n';
import { strings } from '../i18n/strings';
import { RootStackParamList } from '../navigation/types';
import { gutter, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AttachmentViewer'>;

/** What the viewer can page through for an item, in order. */
export function viewableAttachments(
  item: Item | undefined,
): { attachment: Attachment; title: string }[] {
  const t = strings().viewer;
  if (item?.type === 'card') {
    return [
      ...(item.frontImage
        ? [{ attachment: item.frontImage, title: t.frontOfCard }]
        : []),
      ...(item.backImage
        ? [{ attachment: item.backImage, title: t.backOfCard }]
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

function problemText(code: Problem): { title: string; message: string } {
  const p = strings().viewer.problems;
  switch (code) {
    case 'MISSING':
      return { title: p.missingTitle, message: p.missingMessage };
    case 'DAMAGED':
      return { title: p.damagedTitle, message: p.damagedMessage };
    case 'KEY_UNAVAILABLE':
      return { title: p.cantOpenTitle, message: p.keyMessage };
    case 'PDF_PROTECTED':
      return { title: p.passwordTitle, message: p.passwordMessage };
    case 'PDF_UNSUPPORTED':
      return { title: p.pdfTitle, message: p.pdfMessage };
    case 'UNDISPLAYABLE':
      return { title: p.imageTitle, message: p.imageMessage };
    default:
      return { title: p.cantOpenTitle, message: p.genericMessage };
  }
}

function ViewerProblem({ code }: { code: Problem }) {
  useStrings();
  const text = problemText(code);
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
  const t = strings().viewer.saveErrors;
  const save = action === 'save';
  switch (code) {
    case 'BUSY':
      return null;
    case 'MISSING':
      return save ? t.missingSaved : t.missingShared;
    case 'DAMAGED':
      return save ? t.damagedSaved : t.damagedShared;
    case 'KEY_UNAVAILABLE':
      return save ? t.keySaved : t.keyShared;
    case 'DESTINATION_NOT_EMPTY':
      return t.notEmpty;
    case 'DESTINATION_UNVERIFIED':
      return t.unverified;
    case 'EXPORT_FAILED':
      return t.failed;
    case 'EXPORT_INCOMPLETE':
      return t.incomplete;
    case 'PICKER_UNAVAILABLE':
      return t.noSaver;
    case 'SHARE_UNAVAILABLE':
      return t.noReceiver;
    default:
      return save ? t.genericSaved : t.genericShared;
  }
}

/**
 * Save a copy (Android's "save to" picker) and Share (the system share sheet)
 * for the file being viewed. Both run natively on a checked copy; the stored
 * encrypted file is only read.
 */
function FileActions({ attachment }: { attachment: Attachment }) {
  const t = useStrings();
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
          setStatus({ text: t.viewer.copySaved, error: false });
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
            label={t.viewer.saveCopy}
            icon={Download}
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={() => run('save')}
          />
        </View>
        <View style={styles.fill}>
          <Button
            label={t.viewer.share}
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
  const t = useStrings();
  return (
    <View style={styles.centre}>
      <Text variant="callout" color="textTertiary" align="center">
        {t.viewer.opening}
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
  const t = useStrings();
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
    files.length > 1 ? t.common.position(index + 1, files.length) : null,
    current ? describeAttachment(current.attachment) : null,
    page && page.count > 1 ? t.viewer.page(page.index + 1, page.count) : null,
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
          backLabel={t.common.close}
          actions={
            files.length > 1 && (
              <>
                <IconButton
                  icon={ChevronLeft}
                  label={t.viewer.previousFile}
                  color={index > 0 ? 'text' : 'textTertiary'}
                  onPress={() => index > 0 && go(index - 1)}
                />
                <IconButton
                  icon={ChevronRight}
                  label={t.viewer.nextFile}
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
            title={t.viewer.notFoundTitle}
            message={t.viewer.notFoundMessage}
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
