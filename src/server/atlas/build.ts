import "server-only";

import { formatMinutes, formatMonthYear } from "@/lib/format";

import { loadCatalog, catalogAvailable } from "../astrometry/catalog";
import { angularSeparation, pixelToSky, type Wcs } from "../astrometry/wcs";
import { listAtlasFrames, pickImage, type AtlasFrameRow, type VariantImages } from "../db/queries";
import { parseRaDec } from "@/lib/coordinates";
import {
  centroidOf,
  formatDecLabel,
  formatRaLabel,
  niceScaleDegrees,
  panelWcs,
  project,
  type PanelPoint,
  type SkyPoint,
} from "./project";

/* ------------------------------------------------------------------ tuning */

/** Intrinsic panel width. The SVG scales with the column; narrow viewports scroll. */
const PANEL_WIDTH = 1180;
const PANEL_MIN_HEIGHT = 380;
const PANEL_MAX_HEIGHT = 820;
/** Breathing room around the outermost footprint, as a fraction of the extent. */
const PANEL_PAD = 0.08;
/** A lone frame would otherwise fill its whole panel edge to edge. */
const MIN_EXTENT_DEG = 6;
/** Side of the square drawn for a frame that has coordinates but no solve. */
const PIN_DEG = 1.5;
/** Two frames of the same target within this are the same patch of sky. */
const SAME_TARGET_DEG = 0.5;
/** Greedy single-linkage radius for grouping targets into one chart. */
const PANEL_LINK_DEG = 20;
/** Catalogue objects smaller than this are noise at panel scale. */
const CONTEXT_MIN_ARCMIN = 20;
const CONTEXT_MIN_SEPARATION_DEG = 0.4;
const CONTEXT_LIMIT = 8;
/**
 * An object spanning most of the panel reads as background wash rather than as
 * a landmark — the Cygnus dark-nebula complexes are all like this.
 */
const CONTEXT_MAX_PANEL_FRACTION = 0.4;

/* ------------------------------------------------------------------- types */

export type AtlasFrameRef = {
  slug: string;
  catalogId: string;
  commonName: string;
  revision: string;
  capturedOn: string;
  dateLabel: string;
  palette: string;
  integrationLabel: string;
  thumb: VariantImages;
};

export type AtlasFootprint = {
  key: string;
  points: string;
  labelX: number;
  labelY: number;
  label: string;
  frames: AtlasFrameRef[];
};

export type AtlasPin = {
  key: string;
  x: number;
  y: number;
  size: number;
  label: string;
  frames: AtlasFrameRef[];
};

export type AtlasContextObject = {
  key: string;
  x: number;
  y: number;
  radius: number;
  label: string;
};

export type AtlasGridLine = {
  key: string;
  points: string;
  label: string;
  labelX: number;
  labelY: number;
  hasLabel: boolean;
};

export type AtlasPanel = {
  id: string;
  title: string;
  width: number;
  height: number;
  frameCount: number;
  centreLabel: string;
  spanLabel: string;
  graticule: { ra: AtlasGridLine[]; dec: AtlasGridLine[] };
  scaleBar: { x: number; y: number; length: number; label: string };
  footprints: AtlasFootprint[];
  pins: AtlasPin[];
  context: AtlasContextObject[];
};

export type AtlasData = {
  panels: AtlasPanel[];
  unplaced: AtlasFrameRef[];
  frameCount: number;
  placedCount: number;
};

/* --------------------------------------------------------------- placement */

type Placement = {
  catalogId: string;
  centre: SkyPoint;
  /** Solved frames carry the real quad; pins are drawn at panel scale instead. */
  cornersSky: SkyPoint[] | null;
  radiusDeg: number;
  frames: AtlasFrameRow[];
};

function toRef(row: AtlasFrameRow): AtlasFrameRef {
  return {
    slug: row.slug,
    catalogId: row.catalogId,
    commonName: row.commonName,
    revision: row.revision,
    capturedOn: row.capturedOn,
    dateLabel: formatMonthYear(row.capturedOn),
    palette: row.palette,
    integrationLabel: formatMinutes(row.totalIntegrationMinutes),
    thumb: pickImage(row.images, "thumb"),
  };
}

/**
 * The solved WCS, if it is complete enough to project with.
 *
 * Note this header describes whichever derivative was sent to the solver — 2048
 * px wide for every frame in the current log, not the 5983 px master. That is
 * fine and is exactly why the corners below are taken in the header's own pixel
 * space: the WCS is self-consistent with its own IMAGEW/IMAGEH.
 */
function parseSolvedWcs(json: string | null): Wcs | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const w = raw as Record<string, unknown>;
  const need = (key: string): number | null => {
    const value = w[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const crval1 = need("crval1");
  const crval2 = need("crval2");
  const crpix1 = need("crpix1");
  const crpix2 = need("crpix2");
  const cd11 = need("cd11");
  const cd22 = need("cd22");
  const imageWidth = need("imageWidth");
  const imageHeight = need("imageHeight");

  if (
    crval1 === null ||
    crval2 === null ||
    crpix1 === null ||
    crpix2 === null ||
    cd11 === null ||
    cd22 === null ||
    !imageWidth ||
    !imageHeight ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const cd12 = need("cd12") ?? 0;
  const cd21 = need("cd21") ?? 0;
  if (cd11 * cd22 - cd12 * cd21 === 0) return null;

  return { crval1, crval2, crpix1, crpix2, cd11, cd12, cd21, cd22, imageWidth, imageHeight };
}

/** Field corners in sky coordinates, walked around the perimeter. */
function footprintCorners(wcs: Wcs): SkyPoint[] {
  const w = wcs.imageWidth;
  const h = wcs.imageHeight;
  return [
    pixelToSky(wcs, 1, 1),
    pixelToSky(wcs, w, 1),
    pixelToSky(wcs, w, h),
    pixelToSky(wcs, 1, h),
  ];
}

/**
 * Where a frame sits, by the first rule that yields a position: the plate solve,
 * then the authored coordinate string, then nowhere. Nothing is silently
 * dropped — a frame with no position at all is listed separately on the page.
 */
function placeFrame(row: AtlasFrameRow): Omit<Placement, "frames"> | null {
  const wcs = row.solveStatus === "solved" ? parseSolvedWcs(row.wcsJson) : null;

  if (wcs) {
    const cornersSky = footprintCorners(wcs);
    const centre = pixelToSky(wcs, (wcs.imageWidth + 1) / 2, (wcs.imageHeight + 1) / 2);
    const radiusDeg = Math.max(
      ...cornersSky.map((c) => angularSeparation(centre.ra, centre.dec, c.ra, c.dec)),
    );
    return { catalogId: row.catalogId, centre, cornersSky, radiusDeg };
  }

  // No solve. The authored plate coordinates are written for humans but
  // `parseRaDec` reads them; in the current log this is M 101's only position.
  const parsed = parseRaDec(row.plateCoordinates);
  if (parsed) {
    return {
      catalogId: row.catalogId,
      centre: parsed,
      cornersSky: null,
      radiusDeg: PIN_DEG * 0.71,
    };
  }

  return null;
}

/**
 * Collapses revisions of one target into a single drawable.
 *
 * Sh2-157 A/B sit 0.002° apart and IC 63 A/B 0.12° apart, so without this the
 * newer revision draws exactly on top of the older one and the covered frame
 * becomes unclickable. The newest frame is the one drawn and linked; the rest
 * stay reachable from the hover card.
 */
function groupRevisions(rows: AtlasFrameRow[]): Placement[] {
  const groups: Placement[] = [];
  const placements = new Map<string, Omit<Placement, "frames">>();

  for (const row of rows) {
    const placement = placeFrame(row);
    if (!placement) continue;
    placements.set(row.slug, placement);

    const host = groups.find(
      (g) =>
        g.catalogId === placement.catalogId &&
        angularSeparation(g.centre.ra, g.centre.dec, placement.centre.ra, placement.centre.dec) <=
          SAME_TARGET_DEG,
    );

    if (host) host.frames.push(row);
    else groups.push({ ...placement, frames: [row] });
  }

  for (const group of groups) {
    group.frames.sort((a, b) =>
      a.capturedOn < b.capturedOn ? 1 : a.capturedOn > b.capturedOn ? -1 : 0,
    );
    // Geometry follows the link: whichever revision is drawn is the one whose
    // solve defines the quad. Taken after the sort so it cannot land on a
    // middle revision when several arrive out of order.
    const newest = placements.get(group.frames[0].slug);
    if (newest) {
      group.centre = newest.centre;
      group.cornersSky = newest.cornersSky;
      group.radiusDeg = newest.radiusDeg;
    }
  }
  return groups;
}

/** Single-linkage grouping into regions; `angularSeparation` handles the RA wrap. */
function clusterIntoPanels(groups: Placement[]): Placement[][] {
  const clusters: Placement[][] = [];

  for (const group of groups) {
    const touching = clusters.filter((cluster) =>
      cluster.some(
        (member) =>
          angularSeparation(member.centre.ra, member.centre.dec, group.centre.ra, group.centre.dec) <=
          PANEL_LINK_DEG,
      ),
    );

    if (touching.length === 0) {
      clusters.push([group]);
      continue;
    }

    // The new group can bridge clusters that were previously separate.
    const merged = [group, ...touching.flat()];
    for (const cluster of touching) clusters.splice(clusters.indexOf(cluster), 1);
    clusters.push(merged);
  }

  return clusters.sort((a, b) => b.length - a.length);
}

/* ------------------------------------------------------------------- panel */

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function expandTo(bounds: Bounds, width: number, height: number): Bounds {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const w = Math.max(bounds.maxX - bounds.minX, width) / 2;
  const h = Math.max(bounds.maxY - bounds.minY, height) / 2;
  return { minX: cx - w, maxX: cx + w, minY: cy - h, maxY: cy + h };
}

/** Catalogue preference for context labels, mirroring the annotation pipeline's. */
const CONTEXT_RANK: [RegExp, number][] = [
  [/^M \d/, 0],
  [/^NGC /, 1],
  [/^IC /, 2],
  [/^Sh2-/, 3],
  [/^LBN /, 4],
  [/^LDN /, 5],
];

const contextRank = (name: string) => CONTEXT_RANK.find(([re]) => re.test(name))?.[1] ?? 9;

function titleFor(cluster: Placement[], centre: SkyPoint): string {
  const counts = new Map<string, number>();
  for (const group of cluster) {
    for (const frame of group.frames) {
      const name = frame.plateConstellation.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : `${formatRaLabel(centre.ra)} ${formatDecLabel(centre.dec)}`;
}

function buildPanel(cluster: Placement[], index: number): AtlasPanel {
  const centre = centroidOf(cluster.map((g) => g.centre));

  // Pass one, in degrees on the tangent plane, purely to size the panel.
  const probe = panelWcs(centre, 1);
  const points: PanelPoint[] = [];
  for (const group of cluster) {
    const sky = group.cornersSky ?? [group.centre];
    for (const corner of sky) {
      const p = project(probe, corner.ra, corner.dec);
      if (p) points.push(p);
    }
    if (!group.cornersSky) {
      // Pins occupy a fixed square; reserve its extent.
      const p = project(probe, group.centre.ra, group.centre.dec);
      if (p) {
        points.push({ x: p.x - PIN_DEG / 2, y: p.y - PIN_DEG / 2 });
        points.push({ x: p.x + PIN_DEG / 2, y: p.y + PIN_DEG / 2 });
      }
    }
  }

  let bounds: Bounds = {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };

  bounds = expandTo(bounds, MIN_EXTENT_DEG, MIN_EXTENT_DEG * (PANEL_MIN_HEIGHT / PANEL_WIDTH));

  const padX = (bounds.maxX - bounds.minX) * PANEL_PAD;
  const padY = (bounds.maxY - bounds.minY) * PANEL_PAD;
  bounds = {
    minX: bounds.minX - padX,
    maxX: bounds.maxX + padX,
    minY: bounds.minY - padY,
    maxY: bounds.maxY + padY,
  };

  // Scale to fill the panel width, unless that would make the panel taller than
  // it is allowed to be — in which case height decides the scale and the extra
  // width becomes sky. Deriving the scale from width alone would leave a tall
  // cluster projecting past the bottom of its own viewBox.
  const contentWidthDeg = bounds.maxX - bounds.minX;
  const contentHeightDeg = bounds.maxY - bounds.minY;
  const pxPerDeg = Math.min(
    PANEL_WIDTH / contentWidthDeg,
    PANEL_MAX_HEIGHT / contentHeightDeg,
  );
  const height = Math.min(
    PANEL_MAX_HEIGHT,
    Math.max(PANEL_MIN_HEIGHT, contentHeightDeg * pxPerDeg),
  );

  // Grow the bounds to exactly the drawn box, so panel pixels and sky degrees
  // stay in step in both axes.
  const widthDeg = PANEL_WIDTH / pxPerDeg;
  bounds = expandTo(bounds, widthDeg, height / pxPerDeg);

  const wcs = panelWcs(centre, pxPerDeg, {
    x: -bounds.minX * pxPerDeg,
    y: -bounds.minY * pxPerDeg,
  });

  const inside = (p: PanelPoint, margin = 0) =>
    p.x >= -margin && p.x <= PANEL_WIDTH + margin && p.y >= -margin && p.y <= height + margin;

  /* Footprints and pins */

  const footprints: AtlasFootprint[] = [];
  const pins: AtlasPin[] = [];

  for (const group of cluster) {
    const frames = group.frames.map(toRef);
    const key = frames[0].slug;

    if (group.cornersSky) {
      const projected = group.cornersSky.map((c) => project(wcs, c.ra, c.dec));
      if (projected.some((p) => p === null)) continue;
      const quad = projected as PanelPoint[];
      const top = quad.reduce((a, b) => (b.y < a.y ? b : a));
      footprints.push({
        key,
        points: quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
        // Above the topmost corner, pulled inside when that would clip.
        labelX: Math.min(Math.max(top.x, 46), PANEL_WIDTH - 46),
        labelY: top.y < 16 ? top.y + 18 : top.y - 7,
        label: frames[0].catalogId,
        frames,
      });
    } else {
      const p = project(wcs, group.centre.ra, group.centre.dec);
      if (!p) continue;
      const size = PIN_DEG * pxPerDeg;
      pins.push({
        key,
        x: p.x - size / 2,
        y: p.y - size / 2,
        size,
        label: frames[0].catalogId,
        frames,
      });
    }
  }

  /* Graticule */

  const corners = [
    pixelToSky(wcs, 0, 0),
    pixelToSky(wcs, PANEL_WIDTH, 0),
    pixelToSky(wcs, PANEL_WIDTH, height),
    pixelToSky(wcs, 0, height),
  ];
  const panelRadiusDeg = Math.max(
    ...corners.map((c) => angularSeparation(centre.ra, centre.dec, c.ra, c.dec)),
  );

  const ra: AtlasGridLine[] = [];
  const dec: AtlasGridLine[] = [];

  const decLo = Math.max(-89.5, centre.dec - panelRadiusDeg - 6);
  const decHi = Math.min(89.5, centre.dec + panelRadiusDeg + 6);

  // Meridians every hour of right ascension.
  for (let hour = 0; hour < 24; hour += 1) {
    const raDeg = hour * 15;
    const samples: PanelPoint[] = [];
    for (let d = decLo; d <= decHi + 0.001; d += 0.5) {
      const p = project(wcs, raDeg, d);
      if (p && inside(p, PANEL_WIDTH)) samples.push(p);
    }
    const line = toGridLine(`ra-${hour}`, samples, formatRaLabel(raDeg), "ra", PANEL_WIDTH, height, inside);
    if (line) ra.push(line);
  }

  // Parallels every five degrees. The RA span widens with declination.
  const raSpan = Math.min(180, panelRadiusDeg / Math.max(0.08, Math.cos(centre.dec * (Math.PI / 180))) + 8);
  for (let d = -85; d <= 85; d += 5) {
    if (d < decLo - 6 || d > decHi + 6) continue;
    const samples: PanelPoint[] = [];
    const step = Math.max(0.25, raSpan / 240);
    for (let offset = -raSpan; offset <= raSpan + 0.001; offset += step) {
      const p = project(wcs, centre.ra + offset, d);
      if (p && inside(p, PANEL_WIDTH)) samples.push(p);
    }
    const line = toGridLine(`dec-${d}`, samples, formatDecLabel(d), "dec", PANEL_WIDTH, height, inside);
    if (line) dec.push(line);
  }

  /* Catalogue context */

  const context: AtlasContextObject[] = [];
  if (catalogAvailable()) {
    const targetNames = new Set(
      cluster.flatMap((g) => g.frames.map((f) => f.catalogId.trim().toLowerCase())),
    );
    const kept: SkyPoint[] = cluster.map((g) => g.centre);

    const maxDiamDeg = (PANEL_WIDTH * CONTEXT_MAX_PANEL_FRACTION) / pxPerDeg;

    const candidates = loadCatalog()
      .objects.filter(
        ([name, objRa, objDec, diam]) =>
          diam >= CONTEXT_MIN_ARCMIN &&
          diam / 60 <= maxDiamDeg &&
          !targetNames.has(name.trim().toLowerCase()) &&
          angularSeparation(centre.ra, centre.dec, objRa, objDec) <= panelRadiusDeg + 2,
      )
      // Landmarks first: a reader orients off M 31 or NGC 7380, not off the LDN
      // number for a patch of obscuration. Size only breaks ties within a rank.
      .sort((a, b) => contextRank(a[0]) - contextRank(b[0]) || b[3] - a[3]);

    for (const [name, objRa, objDec, diam] of candidates) {
      if (context.length >= CONTEXT_LIMIT) break;
      if (
        kept.some((k) => angularSeparation(k.ra, k.dec, objRa, objDec) < CONTEXT_MIN_SEPARATION_DEG)
      ) {
        continue;
      }
      const p = project(wcs, objRa, objDec);
      if (!p || !inside(p, -20)) continue;

      kept.push({ ra: objRa, dec: objDec });
      context.push({
        key: name,
        x: p.x,
        y: p.y,
        radius: Math.max(6, ((diam / 60) * pxPerDeg) / 2),
        label: name,
      });
    }
  }

  /* Scale bar */

  const scaleDeg = niceScaleDegrees(widthDeg * 0.2);

  return {
    id: `panel-${index}`,
    title: titleFor(cluster, centre),
    width: PANEL_WIDTH,
    height,
    frameCount: cluster.reduce((sum, g) => sum + g.frames.length, 0),
    centreLabel: `${formatRaLabel(centre.ra)} ${formatDecLabel(centre.dec)}`,
    spanLabel: `${widthDeg.toFixed(1)}° × ${(height / pxPerDeg).toFixed(1)}°`,
    graticule: { ra, dec },
    scaleBar: {
      x: 28,
      y: height - 28,
      length: scaleDeg * pxPerDeg,
      label: scaleDeg >= 1 ? `${scaleDeg}°` : `${scaleDeg * 60}′`,
    },
    footprints,
    pins,
    context,
  };
}

/**
 * Turns sampled points into a polyline, dropping lines that never enter the
 * panel. Under a gnomonic projection graticule lines are curves, so they are
 * sampled and drawn as polylines rather than straight segments.
 */
function toGridLine(
  key: string,
  samples: PanelPoint[],
  label: string,
  axis: "ra" | "dec",
  width: number,
  height: number,
  inside: (p: PanelPoint, margin?: number) => boolean,
): AtlasGridLine | null {
  if (samples.length < 2) return null;
  const visible = samples.filter((p) => inside(p));
  if (visible.length === 0) return null;

  // Meridians label along the bottom edge, parallels along the left edge.
  const anchor =
    axis === "ra"
      ? visible.reduce((a, b) => (b.y > a.y ? b : a))
      : visible.reduce((a, b) => (b.x < a.x ? b : a));

  const labelX = axis === "ra" ? anchor.x : Math.max(anchor.x, 8);
  const labelY = axis === "ra" ? Math.min(anchor.y, height - 8) : anchor.y;

  return {
    key,
    points: samples.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    label,
    labelX,
    labelY,
    // Suppress a label pinned into the corner, where the two axes collide.
    hasLabel: axis === "ra" ? labelX > 40 && labelX < width - 12 : labelY > 16 && labelY < height - 26,
  };
}

/* -------------------------------------------------------------------- main */

export async function buildAtlas(): Promise<AtlasData> {
  const rows = await listAtlasFrames();

  const groups = groupRevisions(rows);
  const placedSlugs = new Set(groups.flatMap((g) => g.frames.map((f) => f.slug)));
  const unplaced = rows.filter((r) => !placedSlugs.has(r.slug)).map(toRef);

  const panels = clusterIntoPanels(groups).map((cluster, i) => buildPanel(cluster, i));

  return {
    panels,
    unplaced,
    frameCount: rows.length,
    placedCount: placedSlugs.size,
  };
}
