import "server-only";

import { pixelToSky, skyToPixel, type Wcs } from "../astrometry/wcs";

/**
 * Panel projection for the sky atlas.
 *
 * Each panel is treated as a synthetic gnomonic "plate": we fabricate a `Wcs`
 * centred on the panel and push every drawable — footprint corners, pins,
 * graticule samples, catalogue circles — through the same `skyToPixel` the
 * plate-solve pipeline already uses. No second projection implementation.
 */

export type SkyPoint = { ra: number; dec: number };
export type PanelPoint = { x: number; y: number };

const DEG = Math.PI / 180;

/** Unit vector on the celestial sphere. */
function toVector({ ra, dec }: SkyPoint): [number, number, number] {
  const a = ra * DEG;
  const d = dec * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/**
 * Mean direction of several sky positions.
 *
 * Averaged as 3D vectors rather than as RA/Dec numbers: the Cassiopeia group
 * spans RA 341° through 44°, and a naive mean of those puts its centre near
 * RA 120° — a point in Leo, with nothing from the group anywhere near the
 * resulting panel.
 */
export function centroidOf(points: SkyPoint[]): SkyPoint {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const [vx, vy, vz] = toVector(p);
    x += vx;
    y += vy;
    z += vz;
  }
  const length = Math.hypot(x, y, z);
  // Only reachable if the points cancel out exactly (antipodal pairs), which
  // cannot happen for a cluster held together by a 20° radius.
  if (length === 0) return { ra: points[0]?.ra ?? 0, dec: points[0]?.dec ?? 0 };

  const ra = (Math.atan2(y, x) / DEG + 360) % 360;
  const dec = Math.asin(z / length) / DEG;
  return { ra, dec };
}

/**
 * Builds the panel's plate.
 *
 * Sign convention, which is the whole ballgame: star charts are north-up and
 * **east-left**, while SVG's y axis grows downward. Both CD terms are therefore
 * negative — `skyToPixel` then maps increasing RA to decreasing x and
 * increasing Dec to decreasing y. Flipping either sign silently renders a
 * mirrored sky that still looks plausible.
 */
export function panelWcs(centre: SkyPoint, pxPerDeg: number, origin: PanelPoint = { x: 0, y: 0 }): Wcs {
  const scale = 1 / pxPerDeg; // degrees per pixel
  return {
    crval1: centre.ra,
    crval2: centre.dec,
    crpix1: origin.x,
    crpix2: origin.y,
    cd11: -scale,
    cd12: 0,
    cd21: 0,
    cd22: -scale,
    // Unused by the projection itself; the panel's extent is the SVG viewBox.
    imageWidth: 0,
    imageHeight: 0,
  };
}

export function project(wcs: Wcs, ra: number, dec: number): PanelPoint | null {
  return skyToPixel(wcs, ra, dec);
}

export function unproject(wcs: Wcs, x: number, y: number): SkyPoint {
  return pixelToSky(wcs, x, y);
}

/** 314.7 -> "21H". Whole hours only; the graticule draws nothing finer. */
export function formatRaLabel(raDeg: number): string {
  const hours = Math.round((((raDeg % 360) + 360) % 360) / 15) % 24;
  return `${hours}H`;
}

/** 40 -> "+40°" */
export function formatDecLabel(decDeg: number): string {
  const rounded = Math.round(decDeg);
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)}°`;
}

/** Round number of degrees for a scale bar spanning roughly `targetDeg`. */
export function niceScaleDegrees(targetDeg: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30];
  return steps.find((s) => s >= targetDeg) ?? steps[steps.length - 1];
}
