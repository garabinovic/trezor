import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, PixelRatio, StyleSheet, View } from 'react-native';
import { Text } from '../components';
import type { Attachment } from '../data/types';
import { Theme, useStyles } from '../theme';
import {
  AttachmentErrorCode,
  nativeAttachmentPlatform,
  OpenPdf,
} from './platform';

export type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: OpenPdf }
  | { status: 'error'; code: AttachmentErrorCode };

/** Opens `attachment` as a PDF while mounted; closing deletes its copy and pages. */
export function usePdfDocument(attachment: Attachment): PdfState {
  const [state, setState] = useState<PdfState>({ status: 'loading' });
  const current = useRef(attachment);
  current.current = attachment;

  useEffect(() => {
    let active = true;
    let handle: string | null = null;
    setState({ status: 'loading' });
    nativeAttachmentPlatform.openPdf(current.current).then(
      pdf => {
        if (active) {
          handle = pdf.handle;
          setState({ status: 'ready', pdf });
        } else {
          closePdf(pdf.handle);
        }
      },
      e => {
        if (active) {
          setState({
            status: 'error',
            code: (e as { code?: AttachmentErrorCode }).code ?? 'UNKNOWN',
          });
        }
      },
    );
    return () => {
      active = false;
      if (handle) {
        closePdf(handle);
      }
    };
  }, [attachment.id]);

  return state;
}

function closePdf(handle: string) {
  nativeAttachmentPlatform
    .closePdf(handle)
    .catch(() => console.warn('[attachments] could not close PDF'));
}

const PAGE_GAP = 12;

/** Every page of an open PDF, rendered when it scrolls into view. */
export function PdfPages({
  pdf,
  width,
  onPageChange,
}: {
  pdf: OpenPdf;
  /** Width available for a page, in layout points. */
  width: number;
  /** Zero-based index of the page mostly in view. */
  onPageChange: (index: number) => void;
}) {
  const styles = useStyles(createStyles);
  const pageWidth = Math.max(1, width - 2 * PAGE_GAP);

  const onViewable = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: { index?: number | null; isViewable: boolean }[];
    }) => {
      const first = viewableItems.find(v => v.isViewable);
      if (first?.index != null) {
        onPageChange(first.index);
      }
    },
  ).current;

  const renderItem = useCallback(
    ({ item, index }: { item: OpenPdf['pages'][number]; index: number }) => (
      <PdfPage
        handle={pdf.handle}
        index={index}
        count={pdf.pages.length}
        width={pageWidth}
        height={(pageWidth * item.height) / item.width}
      />
    ),
    [pdf, pageWidth],
  );

  return (
    <FlatList
      data={pdf.pages}
      keyExtractor={(_, index) => String(index)}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={Separator}
      initialNumToRender={2}
      windowSize={5}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
    />
  );
}

function Separator() {
  return <View style={{ height: PAGE_GAP }} />;
}

/** One page: rendered natively at screen resolution, deleted when unmounted. */
function PdfPage({
  handle,
  index,
  count,
  width,
  height,
}: {
  handle: string;
  index: number;
  count: number;
  width: number;
  height: number;
}) {
  const styles = useStyles(createStyles);
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const widthPx = Math.round(PixelRatio.getPixelSizeForLayoutSize(width));

  useEffect(() => {
    let active = true;
    let rendered: string | null = null;
    setUri(null);
    setFailed(false);
    nativeAttachmentPlatform.renderPdfPage(handle, index, widthPx).then(
      page => {
        if (active) {
          rendered = page;
          setUri(page);
        } else {
          releasePage(page);
        }
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
      if (rendered) {
        releasePage(rendered);
      }
    };
  }, [handle, index, widthPx]);

  const label = `Page ${index + 1} of ${count}`;
  return (
    <View style={[styles.page, { width, height }]}>
      {failed ? (
        <View style={styles.pageProblem} accessible accessibilityLabel={label}>
          <Text variant="caption" color="textTertiary" align="center">
            This page can’t be shown
          </Text>
        </View>
      ) : (
        uri && (
          <Image
            source={{ uri }}
            style={styles.pageImage}
            accessibilityLabel={label}
            resizeMode="contain"
          />
        )
      )}
    </View>
  );
}

function releasePage(uri: string) {
  nativeAttachmentPlatform
    .closeView(uri)
    .catch(() => console.warn('[attachments] could not delete page file'));
}

const createStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    list: { padding: PAGE_GAP },
    page: {
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    pageImage: { width: '100%', height: '100%' },
    pageProblem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });
