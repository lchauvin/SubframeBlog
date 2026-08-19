import "server-only";

import fs from "node:fs";
import path from "node:path";

import { angularSeparation, pixelToSky, skyToPixel, type Wcs } from "./wcs";

/** [name, raDeg, decDeg, majorAxisArcmin, type] */
type Row = [string, number, number, number, string];

type CatalogFile = {
  generated: string;
  sources: string[];
  counts: Record<string, number>;
  objects: Row[];
};

/** Nominal image width the design's radiusPx unit is expressed against. */
const DESIGN_WIDTH = 1600;
// The design's own markers run 22-54 design px. A frame-filling nebula would
// otherwise draw a circle the size of the picture, which points at nothing.
const MIN_RADIUS = 16;
const MAX_RADIUS = 64;
/** Keep marker centres off the very edge, where the circle would be clipped. */
const EDGE_INSET = 0.02;

/**
 * Catalogue preference when several designations describe the same patch of
 * sky. The Soul Nebula is IC 1848 *and* Sh2-199 *and* LBN 667; the design shows
 * one marker, not three.
 */
const PRIORITY: [RegExp, number][] = [
  [/^M \d/, 0],
  [/^NGC /, 1],
  [/^IC /, 2],
  [/^Sh2-/, 3],
  [/^LBN /, 4],
  [/^LDN /, 5],
];

const priorityOf = (name: string) =>
  PRIORITY.find(([re]) => re.test(name))?.[1] ?? 9;

// Read from disk rather than importing, so 600KB of reference data never ends
// up inside a build bundle. Cached for the life of the process.
let cache: CatalogFile | null = null;

export function loadCatalog(): CatalogFile {
  if (cache) return cache;
  const file = path.join(process.cwd(), "catalog", "deep-sky.json");
  cache = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogFile;
  return cache;
}

export const catalogAvailable = () =>
  fs.existsSync(path.join(process.cwd(), "catalog", "deep-sky.json"));

export type CatalogMarker = {
  label: string;
  xPct: number;
  yPct: number;
  radiusPx: number;
  diamArcmin: number;
};

/**
 * Finds catalogue objects that actually fall inside a solved frame and places
 * them, using the WCS rather than anything the solver chose to annotate.
 */
export function markersForFrame(
  wcs: Wcs,
  image: { width: number; height: number },
  opts: { limit?: number; minFractionOfWidth?: number; targetName?: string } = {},
): { markers: CatalogMarker[]; consideredCount: number } {
  const limit = opts.limit ?? 8;
  // Ignore anything too small to read as a marked object at page size.
  const minFraction = opts.minFractionOfWidth ?? 0.004;
  // The frame's own designation always wins its cluster: an article about
  // IC 1848 should not label its subject Sh2-199.
  const target = opts.targetName?.trim().toLowerCase() ?? "";

  const { objects } = loadCatalog();

  // Field geometry, straight from the WCS.
  const centre = pixelToSky(wcs, (image.width + 1) / 2, (image.height + 1) / 2);
  const corner = pixelToSky(wcs, 1, 1);
  const radiusDeg = angularSeparation(centre.ra, centre.dec, corner.ra, corner.dec);

  const arcsecPerPx =
    Math.sqrt(Math.abs(wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21)) * 3600;

  // Cheap declination band first: a full angular separation for 15k objects on
  // every solve is wasteful when most are nowhere near the field.
  const decLo = centre.dec - radiusDeg;
  const decHi = centre.dec + radiusDeg;

  const candidates: (CatalogMarker & { priority: number })[] = [];

  for (const [name, ra, dec, diamArcmin] of objects) {
    if (dec < decLo || dec > decHi) continue;
    if (angularSeparation(centre.ra, centre.dec, ra, dec) > radiusDeg) continue;

    const pixel = skyToPixel(wcs, ra, dec);
    if (!pixel) continue;
    const insetX = image.width * EDGE_INSET;
    const insetY = image.height * EDGE_INSET;
    if (
      pixel.x < insetX ||
      pixel.x > image.width - insetX ||
      pixel.y < insetY ||
      pixel.y > image.height - insetY
    ) {
      continue;
    }

    // Objects with no recorded size still get a small marker rather than being
    // dropped — plenty of real targets have a blank MajAx.
    const diam = diamArcmin > 0 ? diamArcmin : 1;
    const diameterPx = (diam * 60) / arcsecPerPx;
    const fraction = diameterPx / image.width;
    if (fraction < minFraction) continue;

    candidates.push({
      label: name,
      xPct: Number(((pixel.x / image.width) * 100).toFixed(2)),
      yPct: Number(((pixel.y / image.height) * 100).toFixed(2)),
      radiusPx: Math.round(
        Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, fraction * DESIGN_WIDTH)),
      ),
      diamArcmin: diam,
      // A designation matching the article's own target outranks every catalogue.
      priority: name.toLowerCase() === target ? -1 : priorityOf(name),
    });
  }

  const consideredCount = candidates.length;

  // Largest first, so each cluster forms around its most prominent member.
  candidates.sort((a, b) => b.diamArcmin - a.diamArcmin);

  /**
   * Cluster concentric designations. IC 1848, Sh2-199 and LBN 667 are one
   * nebula under three catalogues; the design shows one marker. Clustering
   * first and *then* choosing the label means the best-known name survives,
   * rather than whichever catalogue happens to list the largest diameter.
   */
  const clusters: { members: typeof candidates; radiusPx: number }[] = [];

  for (const c of candidates) {
    const cxPx = (c.xPct / 100) * image.width;
    const cyPx = (c.yPct / 100) * image.height;
    const own = (c.diamArcmin * 60) / arcsecPerPx / 2;

    const host = clusters.find((cluster) => {
      const head = cluster.members[0];
      const dx = cxPx - (head.xPct / 100) * image.width;
      const dy = cyPx - (head.yPct / 100) * image.height;
      return Math.hypot(dx, dy) < Math.max(cluster.radiusPx, own) * 0.6;
    });

    if (host) host.members.push(c);
    else clusters.push({ members: [c], radiusPx: own });
  }

  const markers = clusters
    .slice(0, limit)
    .map(({ members }) => {
      // Best name in the cluster; geometry from the member that carries it.
      const best = [...members].sort((a, b) => a.priority - b.priority)[0];
      const largest = members[0];
      return {
        label: best.label,
        xPct: best.xPct,
        yPct: best.yPct,
        radiusPx: Math.max(best.radiusPx, largest.radiusPx),
        diamArcmin: largest.diamArcmin,
      };
    });

  return { markers, consideredCount };
}
