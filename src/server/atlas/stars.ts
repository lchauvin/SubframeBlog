import "server-only";

import fs from "node:fs";
import path from "node:path";

import { angularSeparation } from "../astrometry/wcs";

/**
 * Bright-star backdrop for the sky atlas.
 *
 * Purely scenery: these are never identified, matched or labelled against a
 * frame, they just make a region recognisable — the W of Cassiopeia and the
 * Northern Cross do more to locate a footprint than any amount of graticule.
 */

/** [raDeg, decDeg, vmag, bayerLabel?] */
type StarRow = [number, number, number, string?];

type StarFile = {
  generated: string;
  magnitudeLimit: number;
  labelMagnitude: number;
  count: number;
  stars: StarRow[];
};

export type PanelStar = {
  ra: number;
  dec: number;
  vmag: number;
  label?: string;
};

// Read from disk rather than imported, so 180KB of reference data never ends up
// inside a build bundle. Cached for the life of the process.
let cache: StarFile | null = null;

function starsPath(): string {
  const candidates = [
    path.join(process.cwd(), "catalog", "stars.json"),
    process.argv[1] ? path.join(path.dirname(process.argv[1]), "catalog", "stars.json") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export const starsAvailable = () => fs.existsSync(starsPath());

export function loadStars(): StarFile {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(starsPath(), "utf8")) as StarFile;
  return cache;
}

/**
 * How faint to go for a panel of this width.
 *
 * Every panel is drawn the same number of pixels wide, so a wide one packs far
 * more sky into each pixel and needs a brighter cut to stay legible. Only the
 * widest panels need pulling back; below that the Yale catalogue's own ~6.5
 * completeness limit is the real constraint, and a deeper cut would need a
 * different catalogue rather than a different threshold.
 */
export function magnitudeLimitFor(spanDeg: number): number {
  if (spanDeg > 35) return 6;
  return 6.5;
}

/** Stars inside a cone, brightest first so labels resolve collisions sensibly. */
export function starsWithin(
  centre: { ra: number; dec: number },
  radiusDeg: number,
  magLimit: number,
): PanelStar[] {
  if (!starsAvailable()) return [];

  const decLo = centre.dec - radiusDeg;
  const decHi = centre.dec + radiusDeg;
  const out: PanelStar[] = [];

  for (const [ra, dec, vmag, label] of loadStars().stars) {
    if (vmag > magLimit) continue;
    // Cheap declination band before the trigonometry.
    if (dec < decLo || dec > decHi) continue;
    if (angularSeparation(centre.ra, centre.dec, ra, dec) > radiusDeg) continue;
    out.push(label ? { ra, dec, vmag, label } : { ra, dec, vmag });
  }

  out.sort((a, b) => a.vmag - b.vmag);
  return out;
}

/**
 * Drawn radius in panel pixels. Magnitude is logarithmic in flux but a chart
 * reads better on a linear ramp — this is how printed atlases size their dots.
 */
export function starRadius(vmag: number): number {
  return Math.max(0.6, (7 - vmag) * 0.5);
}
