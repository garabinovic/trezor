import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ImageOff } from 'lucide-react-native';
import { Icon, Text } from '../components';
import type { Attachment } from '../data/types';
import { useStrings } from '../i18n';
import type { Strings } from '../i18n/strings';
import { Theme, useStyles } from '../theme';
import { AttachmentErrorCode, nativeAttachmentPlatform } from './platform';

export type AttachmentViewState =
  | { status: 'loading' }
  | { status: 'ready'; uri: string }
  | { status: 'error'; code: AttachmentErrorCode };

/**
 * A decrypted, checked copy of `attachment` while the caller is mounted.
 * The copy is deleted when the attachment changes or the caller unmounts.
 */
export function useAttachmentView(
  attachment: Attachment | null,
): AttachmentViewState {
  const [state, setState] = useState<AttachmentViewState>({
    status: 'loading',
  });
  const current = useRef(attachment);
  current.current = attachment;
  // A stored attachment never changes; a different one has a different id.
  const key = attachment ? attachment.id : null;

  useEffect(() => {
    const target = current.current;
    if (!target) {
      return;
    }
    let active = true;
    let uri: string | null = null;
    setState({ status: 'loading' });
    nativeAttachmentPlatform.openView(target).then(
      opened => {
        if (active) {
          uri = opened;
          setState({ status: 'ready', uri: opened });
        } else {
          close(opened);
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
      if (uri) {
        close(uri);
      }
    };
  }, [key]);

  return state;
}

function close(uri: string) {
  nativeAttachmentPlatform
    .closeView(uri)
    .catch(() => console.warn('[attachments] could not delete view file'));
}

function problemText(
  code: AttachmentErrorCode | 'UNDISPLAYABLE',
  t: Strings['viewer']['photoProblems'],
): string {
  switch (code) {
    case 'MISSING':
      return t.missing;
    case 'DAMAGED':
      return t.damaged;
    case 'UNDISPLAYABLE':
      return t.unsupported;
    default:
      return t.failed;
  }
}

/** An encrypted photo, fitted inside a muted tile. */
export function AttachmentImage({
  attachment,
  label,
  style,
}: {
  attachment: Attachment;
  /** Accessibility label, e.g. "Front of card". */
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(createStyles);
  const t = useStrings().viewer.photoProblems;
  const view = useAttachmentView(attachment);
  const [undisplayable, setUndisplayable] = useState<string | null>(null);

  const problem =
    view.status === 'error'
      ? view.code
      : view.status === 'ready' && undisplayable === view.uri
      ? 'UNDISPLAYABLE'
      : null;

  return (
    <View style={[styles.tile, style]}>
      {problem ? (
        <View
          style={styles.problem}
          accessible
          accessibilityLabel={`${label}: ${problemText(problem, t)}`}
        >
          <Icon icon={ImageOff} color="textTertiary" />
          <Text variant="caption" color="textTertiary" align="center">
            {problemText(problem, t)}
          </Text>
        </View>
      ) : (
        view.status === 'ready' && (
          <Image
            source={{ uri: view.uri }}
            style={styles.image}
            resizeMode="contain"
            // Decode at display size, not the photo's full resolution.
            resizeMethod="resize"
            accessibilityLabel={label}
            onError={() => setUndisplayable(view.uri)}
          />
        )
      )}
    </View>
  );
}

/** ID-1 card proportions (85.6 × 54 mm). */
export const CARD_ASPECT_RATIO = 85.6 / 54;

const createStyles = ({ colors, radius, spacing }: Theme) =>
  StyleSheet.create({
    tile: {
      aspectRatio: CARD_ASPECT_RATIO,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    image: { width: '100%', height: '100%' },
    problem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      padding: spacing.sm,
    },
  });
