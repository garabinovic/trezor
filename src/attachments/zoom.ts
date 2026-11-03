/**
 * Pinch, pan and double-tap math for the image viewer. A transform is applied
 * as translate(x, y) then scale around the view's centre, so a point `p`
 * (relative to the centre) is drawn at `x + scale * p`.
 */
export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A point relative to the view's centre. */
export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
export const IDENTITY: ZoomTransform = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Keeps the scale in range and the content covering the view (no empty edges). */
export function clampTransform(t: ZoomTransform, size: Size): ZoomTransform {
  const scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
  const maxX = (size.width * (scale - 1)) / 2;
  const maxY = (size.height * (scale - 1)) / 2;
  return {
    scale,
    x: clamp(t.x, -maxX, maxX),
    y: clamp(t.y, -maxY, maxY),
  };
}

/** Scales by the change in finger distance, keeping the content under `focal` in place. */
export function pinch(
  start: ZoomTransform,
  startDistance: number,
  distance: number,
  focal: Point,
  size: Size,
): ZoomTransform {
  if (startDistance <= 0) {
    return start;
  }
  const scale = clamp(
    (start.scale * distance) / startDistance,
    MIN_SCALE,
    MAX_SCALE,
  );
  const k = scale / start.scale;
  return clampTransform(
    {
      scale,
      x: focal.x - (focal.x - start.x) * k,
      y: focal.y - (focal.y - start.y) * k,
    },
    size,
  );
}

/** Moves zoomed content with one finger; nothing moves at scale 1. */
export function pan(
  start: ZoomTransform,
  dx: number,
  dy: number,
  size: Size,
): ZoomTransform {
  return clampTransform({ ...start, x: start.x + dx, y: start.y + dy }, size);
}

/** Zooms in around the tapped point, or back out when already zoomed. */
export function doubleTap(
  current: ZoomTransform,
  point: Point,
  size: Size,
): ZoomTransform {
  if (current.scale > MIN_SCALE) {
    return IDENTITY;
  }
  return pinch(current, 1, DOUBLE_TAP_SCALE, point, size);
}
