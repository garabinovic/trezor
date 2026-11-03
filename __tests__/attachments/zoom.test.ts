import {
  clampTransform,
  doubleTap,
  IDENTITY,
  MAX_SCALE,
  pan,
  pinch,
} from '../../src/attachments/zoom';

const size = { width: 400, height: 800 };

describe('zoom math', () => {
  test('pinching scales by the change in finger distance, within limits', () => {
    expect(pinch(IDENTITY, 100, 200, { x: 0, y: 0 }, size).scale).toBe(2);
    expect(pinch(IDENTITY, 100, 50, { x: 0, y: 0 }, size).scale).toBe(1);
    expect(pinch(IDENTITY, 100, 1000, { x: 0, y: 0 }, size).scale).toBe(
      MAX_SCALE,
    );
  });

  test('the point between the fingers stays where it was', () => {
    const focal = { x: 100, y: -200 };
    const t = pinch(IDENTITY, 100, 200, focal, size);
    // Content point under the focal point before: focal itself (scale 1).
    expect(t.x + t.scale * focal.x).toBeCloseTo(focal.x);
    expect(t.y + t.scale * focal.y).toBeCloseTo(focal.y);
  });

  test('panning moves zoomed content but never past its edges', () => {
    expect(pan(IDENTITY, 50, 50, size)).toEqual(IDENTITY);
    const zoomed = { scale: 2, x: 0, y: 0 };
    expect(pan(zoomed, 50, -60, size)).toEqual({ scale: 2, x: 50, y: -60 });
    expect(pan(zoomed, 1000, 1000, size)).toEqual({ scale: 2, x: 200, y: 400 });
  });

  test('double tap zooms in at the tapped point and back out', () => {
    const inT = doubleTap(IDENTITY, { x: 40, y: 80 }, size);
    expect(inT.scale).toBe(2.5);
    expect(inT.x + inT.scale * 40).toBeCloseTo(40);
    expect(doubleTap(inT, { x: 0, y: 0 }, size)).toEqual(IDENTITY);
  });

  test('clamping repairs out-of-range transforms', () => {
    expect(clampTransform({ scale: 0.2, x: 30, y: 30 }, size)).toEqual(
      IDENTITY,
    );
  });
});
