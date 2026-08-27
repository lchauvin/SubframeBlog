import { pixelToSky, skyToPixel, type Wcs } from "./wcs";

/**
 * How to lay one frame's image over another so the same star lands on the same
 * spot.
 *
 * Expressed in the reference frame's pixel space: a point `b` in the other
 * image maps to `scale * R(rotation) * b + (tx, ty)`.
 */
export type Alignment = {
  scale: number;
  /** Radians, counter-clockwise. */
  rotation: number;
  tx: number;
  ty: number;
  /** Pixel space the transform is expressed in — the reference solve's own. */
  refWidth: number;
  refHeight: number;
  /** Pixel space the transform consumes. */
  otherWidth: number;
  otherHeight: number;
  /** Arcseconds per reference pixel, for reporting the scale difference. */
  refScaleArcsec: number;
  otherScaleArcsec: number;
};

/**
 * Derives the transform from two plate solves, by going through the sky.
 *
 * Two processings of one target are not the same picture: they are cropped
 * differently, rotated differently, and scaled differently — IC 63's two frames
 * sit 14.5% apart in plate scale with identical optics, purely from cropping.
 * Overlaying them on pixel coordinates would be meaningless. Sky coordinates
 * are the only thing the two images genuinely share, and both frames already
 * carry a full WCS from the plate solve, so the mapping costs nothing to
 * compute and needs no image registration.
 *
 * A similarity transform — uniform scale, rotation, translation — rather than a
 * full re-projection. Over a field of a degree or two the difference between
 * the two tangent planes is far below a pixel, and a similarity can be handed
 * to CSS as a single transform, which keeps the browser compositor doing the
 * work. Two correspondences determine it exactly.
 */
export function alignWcs(reference: Wcs, other: Wcs): Alignment | null {
  const cx = reference.imageWidth / 2;
  const cy = reference.imageHeight / 2;
  // A quarter-width baseline: long enough that rounding in the projection does
  // not dominate the angle, short enough to stay well inside both fields.
  const baseline = reference.imageWidth / 4;
  if (baseline <= 0) return null;

  const skyCentre = pixelToSky(reference, cx, cy);
  const skyOffset = pixelToSky(reference, cx + baseline, cy);

  const p0 = skyToPixel(other, skyCentre.ra, skyCentre.dec);
  const p1 = skyToPixel(other, skyOffset.ra, skyOffset.dec);
  // Null means the point is on the far hemisphere — the two frames are not of
  // the same patch of sky at all.
  if (!p0 || !p1) return null;

  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const lengthInOther = Math.hypot(vx, vy);
  if (!Number.isFinite(lengthInOther) || lengthInOther < 1e-6) return null;

  const scale = baseline / lengthInOther;
  // The reference baseline runs along +x, so its own angle is zero and the
  // rotation needed is simply the negation of the other frame's angle.
  const rotation = -Math.atan2(vy, vx);

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tx = cx - scale * (cos * p0.x - sin * p0.y);
  const ty = cy - scale * (sin * p0.x + cos * p0.y);

  if (![scale, rotation, tx, ty].every(Number.isFinite)) return null;

  return {
    scale,
    rotation,
    tx,
    ty,
    refWidth: reference.imageWidth,
    refHeight: reference.imageHeight,
    otherWidth: other.imageWidth,
    otherHeight: other.imageHeight,
    refScaleArcsec: arcsecPerPixel(reference),
    otherScaleArcsec: arcsecPerPixel(other),
  };
}

/** Plate scale from the CD matrix, in arcseconds per pixel. */
export function arcsecPerPixel(wcs: Wcs): number {
  const det = Math.abs(wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21);
  return Math.sqrt(det) * 3600;
}

/** The region of the reference frame that the other frame also covers. */
export type Overlap = {
  /** Bounding box of the shared region, in reference pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shared area as a fraction of the reference frame. */
  fraction: number;
  /**
   * The shared region itself, in reference pixels.
   *
   * The bounding box is not enough to show it: a frame rotated 99° meets
   * another in a quadrilateral whose bounding box is most of the frame, so
   * clipping to the box would still put un-comparable sky on screen — which is
   * the entire problem this is here to solve.
   */
  points: { x: number; y: number }[];
};

type Point = { x: number; y: number };

/** Sutherland–Hodgman: clip a convex polygon against a half-plane. */
function clipHalfPlane(poly: Point[], inside: (p: Point) => boolean, intersect: (a: Point, b: Point) => Point): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const current = poly[i];
    const previous = poly[(i + poly.length - 1) % poly.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn) {
      if (!previousIn) out.push(intersect(previous, current));
      out.push(current);
    } else if (previousIn) {
      out.push(intersect(previous, current));
    }
  }
  return out;
}

const area = (poly: Point[]) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

/**
 * Where the two frames actually see the same sky.
 *
 * Two processings of one target need not share much: IC 63's are 99° apart in
 * rotation and 15% apart in scale, so laying the second over the first and
 * fitting the view to the *first* shows mostly the region only one of them
 * covers. That reads as broken registration when the registration is exact —
 * there is simply nothing to compare over most of the frame. Fitting the view
 * to this region instead puts the shared sky on screen, which is the only part
 * a comparison means anything in.
 */
export function overlapRegion(alignment: Alignment): Overlap | null {
  const { scale, rotation, tx, ty, refWidth, refHeight, otherWidth, otherHeight } = alignment;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const map = (x: number, y: number): Point => ({
    x: scale * (cos * x - sin * y) + tx,
    y: scale * (sin * x + cos * y) + ty,
  });

  let poly: Point[] = [
    map(0, 0),
    map(otherWidth, 0),
    map(otherWidth, otherHeight),
    map(0, otherHeight),
  ];

  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [(p) => p.x >= 0, (a, b) => lerpX(a, b, 0)],
    [(p) => p.x <= refWidth, (a, b) => lerpX(a, b, refWidth)],
    [(p) => p.y >= 0, (a, b) => lerpY(a, b, 0)],
    [(p) => p.y <= refHeight, (a, b) => lerpY(a, b, refHeight)],
  ];
  for (const [inside, intersect] of edges) {
    poly = clipHalfPlane(poly, inside, intersect);
    if (poly.length === 0) return null;
  }

  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    fraction: area(poly) / (refWidth * refHeight),
    points: poly.map((point) => ({ x: point.x, y: point.y })),
  };
}

const lerpX = (a: Point, b: Point, x: number): Point => ({
  x,
  y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1e-9),
});
const lerpY = (a: Point, b: Point, y: number): Point => ({
  x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-9),
  y,
});
