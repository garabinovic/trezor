import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import {
  doubleTap,
  IDENTITY,
  pan,
  pinch,
  Point,
  Size,
  ZoomTransform,
} from './zoom';
import { useStrings } from '../i18n';

/**
 * The image is laid out at this multiple of the view and scaled down, so it
 * is decoded at enough resolution to stay sharp when zoomed in.
 */
const DECODE_FACTOR = 2;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;

/** A local image that fits the view and can be pinched, panned and double-tapped. */
export function ZoomableImage({
  uri,
  label,
  onError,
}: {
  uri: string;
  label: string;
  onError: () => void;
}) {
  const zoomHint = useStrings().viewer.zoomHint;
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const container = useRef<React.ComponentRef<typeof View>>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const transform = useRef<ZoomTransform>(IDENTITY);
  const scale = useRef(new Animated.Value(1 / DECODE_FACTOR)).current;
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const gesture = useRef({
    start: IDENTITY,
    startDistance: 0,
    mode: null as 'pan' | 'pinch' | null,
    lastTap: 0,
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const responder = useMemo(() => {
    const apply = (t: ZoomTransform) => {
      transform.current = t;
      scale.setValue(t.scale / DECODE_FACTOR);
      offset.setValue({ x: t.x, y: t.y });
    };
    /** A page coordinate relative to the view's centre. */
    const fromCentre = (pageX: number, pageY: number): Point => ({
      x: pageX - origin.current.x - sizeRef.current.width / 2,
      y: pageY - origin.current.y - sizeRef.current.height / 2,
    });
    const g = gesture.current;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        g.start = transform.current;
        g.mode = null;
      },
      onPanResponderMove: (e: GestureResponderEvent, state) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          const [a, b] = touches;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (g.mode !== 'pinch') {
            g.mode = 'pinch';
            g.start = transform.current;
            g.startDistance = distance;
          }
          apply(
            pinch(
              g.start,
              g.startDistance,
              distance,
              fromCentre((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2),
              sizeRef.current,
            ),
          );
        } else if (g.mode !== 'pinch' && transform.current.scale > 1) {
          g.mode = 'pan';
          apply(pan(g.start, state.dx, state.dy, sizeRef.current));
        }
      },
      onPanResponderRelease: (e, state) => {
        const tapped =
          g.mode === null &&
          Math.abs(state.dx) < TAP_SLOP &&
          Math.abs(state.dy) < TAP_SLOP;
        g.mode = null;
        if (!tapped) {
          return;
        }
        const now = Date.now();
        if (now - g.lastTap < DOUBLE_TAP_MS) {
          g.lastTap = 0;
          apply(
            doubleTap(
              transform.current,
              fromCentre(e.nativeEvent.pageX, e.nativeEvent.pageY),
              sizeRef.current,
            ),
          );
        } else {
          g.lastTap = now;
        }
      },
    });
  }, [scale, offset]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
    container.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  };

  return (
    <View
      ref={container}
      testID="image-viewer"
      style={styles.container}
      onLayout={onLayout}
      accessibilityHint={zoomHint}
      {...responder.panHandlers}
    >
      {size.width > 0 && (
        <Animated.Image
          source={{ uri }}
          accessibilityLabel={label}
          resizeMode="contain"
          resizeMethod="resize"
          onError={onError}
          style={[
            styles.image,
            {
              width: size.width * DECODE_FACTOR,
              height: size.height * DECODE_FACTOR,
              left: (size.width * (1 - DECODE_FACTOR)) / 2,
              top: (size.height * (1 - DECODE_FACTOR)) / 2,
              transform: [
                { translateX: offset.x },
                { translateY: offset.y },
                { scale },
              ],
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  image: { position: 'absolute' },
});
