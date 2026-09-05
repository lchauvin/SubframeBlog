import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseRaDec } from "@/lib/coordinates";
import { angularSeparation, pixelToSky } from "../astrometry/wcs";
import { loadConstellations, type ConstellationFigure } from "../atlas/constellations";
import { loadStars } from "../atlas/stars";
import {
  centroidOf,
  formatDecLabel,
  formatRaLabel,
  panelWcs,
  project,
  type PanelPoint,
  type SkyPoint,
} from "../atlas/project";
import { listAtlasFrames, mediaUrl, type AtlasFrameRow } from "../db/queries";
import { CARDS_MEDIA_PREFIX, CARDS_ROOT } from "../paths";
import { CARD_FONT_FAMILY, ensureCardFonts } from "./fonts";

/**
 * One PNG per published frame: where its target sits inside its constellation.
 *
 * Deliberately not a chart. The sky atlas already does the chart job —
 * graticule, field stars, footprints, labels. These are the opposite: a white
 * figure on a transparent ground, carrying no text at all. Only three things
 * are drawn, and nothing else may be added to them:
 *
 *   the constellation's own stars, spiked and sized by magnitude
 *   the lines that join them into the figure
 *   the target, as the same spike in red
 *
 * The graticule is a fourth thing, and the only one that carries text — hours
 * of right ascension along the bottom, degrees of declination up the left.
 * It is written to its own file:
 * `<slug>.png` is the figure and its marker alone, `<slug>-grid.png` is the
 * ruling. The article stacks them; anything else can take the figure on its
 * own. They share one projection pass, so they cannot drift out of register.
 *
 * Positions come from the atlas's catalogues and its `panelWcs` projection, so
 * a card and its atlas panel cannot disagree about where anything is.
 *
 * The article pages show these, so they are written inside the media root and
 * reach the browser through the same route and the same static export as every
 * other image. Transparent means they need a dark ground under them wherever
 * they are placed — on paper, white on white is nothing at all.
 *
 * This module is the shared implementation behind both `npm run
 * cards:constellation` and the admin button, for the same reason
 * `processMaster()` is shared: the script runs through `tsx`, a devDependency
 * that shared hosting may not install, so the server needs a path to this work
 * that does not involve a terminal.
 */

/* ------------------------------------------------------------------ tuning */

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 1200;

/**
 * Room for the spikes. A vertex is fitted as a point, but the star drawn on it
 * reaches `SPIKE_MAX` beyond in every direction, so a tight fit would shear the
 * spikes off the outermost star in the figure.
 */
const FIT_PAD = 118;
/** A floor only, so a figure spanning almost nothing cannot divide by zero. */
const MIN_EXTENT_DEG = 5;
const PAD_FRACTION = 0.08;

/**
 * White on nothing. The PNG keeps its alpha and the card carries no ground of
 * its own, so whatever it is laid over becomes the sky.
 */
const STAR = "#ffffff";
const LINE = "#ffffff";
const MARKER = "#c0392b";

/** Spike half-length in pixels, from visual magnitude. */
const SPIKE_MIN = 18;
const SPIKE_MAX = 68;
/** The target outranks every real star in the figure, Sirius included. */
const TARGET_SPIKE = 70;
/** Spike thickness and dot size, both as fractions of the spike half-length. */
const SPIKE_WIDTH = 0.16;
const DOT_FRACTION = 0.25;
/** Spikes run on the diagonals, leaving the dot clear on both axes. */
const SPIKE_ROTATION = Math.PI / 4;
/** How much of the figure the target clears around itself. */
const TARGET_CLEARANCE = 0.32;

/**
 * The graticule. Faint enough to read as ruling behind the figure and never
 * as part of it — it is orientation, not data, and the card carries no labels
 * to explain it.
 */
const GRID_COLOR = "#ffffff";
const GRID_OPACITY = 0.15;
const GRID_WIDTH = 1.6;
/** The grid layer's file, alongside `<slug>.png`. */
export const GRID_SUFFIX = "-grid";
/** Roughly how many lines to aim for across the card, per axis. */
const GRID_TARGET_LINES = 5;
/**
 * Labels are brighter than their lines. A line only has to be noticed; a
 * label has to be read, and at this size it is thin white text on whatever
 * the card is laid over.
 */
const GRID_LABEL_OPACITY = 0.5;
const GRID_LABEL_SIZE = 27;
const GRID_LABEL_TRACKING = 2.5;
/** How far a label sits from the edge it is anchored to. */
const GRID_LABEL_INSET = 16;
/** Labels are dropped this close to a corner, where the two axes collide. */
const GRID_LABEL_MARGIN = 64;
/** Parallel spacings in degrees, and meridian spacings in hours of RA. */
const DEC_STEPS = [1, 2, 5, 10, 15, 20, 30];
const RA_STEPS_HOURS = [0.25, 0.5, 1, 2, 3, 4, 6];

/** Vertices resolve to catalogue stars well inside this; see the note below. */
const MATCH_TOL_DEG = 0.05;
/** Only used if a figure ever gains a vertex that is not a catalogued star. */
const DEFAULT_VMAG = 4.2;

/* ------------------------------------------------------------------- types */

export type CardOutcome = {
  slug: string;
  catalogId: string;
  ok: boolean;
  /** The constellation drawn, when one was resolved. */
  constellation?: string;
  /** False when the plate's own name did not match and geometry decided. */
  matchedByName?: boolean;
  ra?: number;
  dec?: number;
  /** "plate solve" or "authored coordinates". */
  positionSource?: string;
  /** Why this frame produced no card. */
  message?: string;
};

export type CardRun = {
  outDir: string;
  written: number;
  /** False when the shipped font was missing and the grid was drawn bare. */
  labelled: boolean;
  results: CardOutcome[];
};

export type CardStatus = {
  outDir: string;
  /** Published frames, the set a full run covers. */
  frames: number;
  /** Published frames with a card already on disk. */
  present: number;
  /** Published frames with no card yet, by slug. */
  missing: string[];
  /**
   * Cards on disk with no published frame behind them any more — an unpublished
   * or renamed frame. Reported rather than deleted: this directory is the
   * author's to keep, and a card is still a usable file after its frame goes.
   */
  orphaned: string[];
};

/* ----------------------------------------------------------------- helpers */

const f1 = (n: number) => n.toFixed(1);

/** One spike: a needle through the centre, widest in the middle, pointed at both ends. */
function needle(cx: number, cy: number, length: number, width: number, angle: number): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (dx: number, dy: number) =>
    `${(cx + dx * cos - dy * sin).toFixed(2)} ${(cy + dx * sin + dy * cos).toFixed(2)}`;
  return `M ${at(length, 0)} Q ${at(0, -width)} ${at(-length, 0)} Q ${at(0, width)} ${at(length, 0)} Z`;
}

/** The dot the spikes radiate from, sized with them so the pair stays in step. */
const dotRadius = (length: number) => Math.max(3, length * DOT_FRACTION);

/**
 * A star: a dot with four diffraction spikes, running on the diagonals so they
 * never lie along a constellation line.
 *
 * Built as an explicit circle plus two crossed needles rather than as one
 * four-pointed outline. An outline pinched at the waist bulges back out on its
 * way to each tip however tight the pinch is set, and reads as a rounded square
 * rather than as a dot with spikes — which is the whole point of the shape.
 */
function star(cx: number, cy: number, length: number): string {
  const width = length * SPIKE_WIDTH;
  return (
    `<path d="${needle(cx, cy, length, width, SPIKE_ROTATION)}"/>` +
    `<path d="${needle(cx, cy, length, width, SPIKE_ROTATION + Math.PI / 2)}"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotRadius(length).toFixed(2)}"/>`
  );
}

/**
 * Spike length for a magnitude.
 *
 * Linear in magnitude rather than in flux: magnitude is already logarithmic,
 * and a flux ramp would draw Deneb forty times the size of the faintest star in
 * its own figure. This is how a printed atlas sizes its dots, stretched to suit
 * a spike.
 */
function spikeLength(vmag: number): number {
  return Math.min(SPIKE_MAX, Math.max(SPIKE_MIN, 18 + (5 - vmag) * 7));
}

/** The coarsest spacing that still puts about `target` lines across `span`. */
function stepFor(span: number, ladder: number[], target: number): number {
  const ideal = span / Math.max(1, target);
  return ladder.find((s) => s >= ideal) ?? ladder[ladder.length - 1];
}

/* ----------------------------------------------------------------- placing */

/** Where a frame's target is, by the same order of preference as the atlas. */
function targetOf(row: AtlasFrameRow): { point: SkyPoint; source: string } | null {
  if (
    row.solveStatus === "solved" &&
    typeof row.centerRa === "number" &&
    typeof row.centerDec === "number"
  ) {
    return { point: { ra: row.centerRa, dec: row.centerDec }, source: "plate solve" };
  }
  const parsed = parseRaDec(row.plateCoordinates);
  if (parsed) return { point: parsed, source: "authored coordinates" };
  return null;
}

/**
 * The frame's constellation figure.
 *
 * The authored name wins, because it is the one the site already prints on the
 * spec plate and a card that disagreed with the plate would be worse than one
 * that is merely approximate. "Cygnus / Lacerta border" resolves to the first
 * name, which is how the plate itself reads. Only when nothing matches does
 * geometry decide, by nearest figure vertex.
 */
function figureFor(
  plateConstellation: string,
  target: SkyPoint,
): { figure: ConstellationFigure; matched: boolean } | null {
  const hit = namedConstellationFigure(plateConstellation);
  if (hit) return { figure: hit, matched: true };

  const all = loadConstellations().constellations;
  let best: ConstellationFigure | null = null;
  let bestSep = Infinity;
  for (const figure of all) {
    for (const line of figure.lines) {
      for (const [ra, dec] of line) {
        const sep = angularSeparation(target.ra, target.dec, ra, dec);
        if (sep < bestSep) {
          bestSep = sep;
          best = figure;
        }
      }
    }
  }
  return best ? { figure: best, matched: false } : null;
}

/**
 * The figure a plate's constellation text names, or null when it names none.
 *
 * "Cygnus / Lacerta border" resolves to Cygnus. The plate is saying where the
 * target sits relative to two constellations; the card can only draw one, and
 * the first named is the one the plate leads with.
 */
function namedConstellationFigure(plateConstellation: string): ConstellationFigure | null {
  const all = loadConstellations().constellations;

  const byKey = new Map<string, ConstellationFigure>();
  for (const figure of all) {
    byKey.set(figure.name.toLowerCase(), figure);
    if (!byKey.has(figure.id.toLowerCase())) byKey.set(figure.id.toLowerCase(), figure);
  }

  const claimed = plateConstellation.split("/")[0]?.trim().toLowerCase() ?? "";
  const cleaned = claimed.replace(/\b(border|region|constellation)\b/g, "").trim();
  return byKey.get(cleaned) ?? byKey.get(claimed) ?? null;
}

/**
 * The constellation a card actually draws, for captioning it.
 *
 * Null when the plate names nothing recognisable, in which case the card was
 * drawn from geometry instead and the caller has no honest short label to
 * print — better to print none than to repeat plate text the picture
 * contradicts.
 */
export function drawnConstellationName(plateConstellation: string): string | null {
  return namedConstellationFigure(plateConstellation)?.name ?? null;
}

/**
 * The magnitude of the catalogue star a figure vertex stands for.
 *
 * The figures are stored as bare coordinates with no star identity, but they
 * were traced from the same catalogue: every one of the 767 vertices across all
 * 89 figures lands within 0.01° of a Yale star. So this is a lookup rather than
 * a guess, and the tolerance is loose enough to survive a catalogue refresh
 * without being wide enough to match a different star.
 */
function magnitudeAt(point: SkyPoint): number | null {
  let best: number | null = null;
  let bestSep = Infinity;
  for (const [ra, dec, vmag] of loadStars().stars) {
    // Separation can never be smaller than the declination difference, so this
    // skips almost the whole catalogue before any trigonometry.
    if (Math.abs(dec - point.dec) > MATCH_TOL_DEG) continue;
    const sep = angularSeparation(point.ra, point.dec, ra, dec);
    if (sep < bestSep) {
      bestSep = sep;
      best = vmag;
    }
  }
  return bestSep <= MATCH_TOL_DEG ? best : null;
}

/* ----------------------------------------------------------------- drawing */

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function expandTo(b: Bounds, width: number, height: number): Bounds {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const w = Math.max(b.maxX - b.minX, width) / 2;
  const h = Math.max(b.maxY - b.minY, height) / 2;
  return { minX: cx - w, maxX: cx + w, minY: cy - h, maxY: cy + h };
}

/** The two layers of one card, drawn from a single projection pass. */
type CardLayers = { figure: string; grid: string };

function renderCardLayers(
  target: SkyPoint,
  figure: ConstellationFigure,
  labelled: boolean,
): CardLayers {
  // Serpens is stored as two figures under one name (Caput and Cauda). Drawing
  // only the half that matched would show part of a constellation on a card
  // named for the whole of it.
  const parts = loadConstellations().constellations.filter((fig) => fig.name === figure.name);

  // One entry per star, however many lines meet on it.
  const vertices = new Map<string, SkyPoint>();
  for (const part of parts) {
    for (const line of part.lines) {
      for (const [ra, dec] of line) vertices.set(`${ra},${dec}`, { ra, dec });
    }
  }

  const anchors = [...vertices.values(), target];

  // Framing. Projected at one pixel per degree first, so the bounds come out in
  // degrees and the scale can be solved for directly — the same two-pass fit the
  // atlas panel uses, and the reason RA wrap-around never needs special-casing.
  const centre = centroidOf(anchors);
  const probe = panelWcs(centre, 1);
  const probed = anchors
    .map((p) => project(probe, p.ra, p.dec))
    .filter((p): p is PanelPoint => p !== null);

  let bounds: Bounds = {
    minX: Math.min(...probed.map((p) => p.x)),
    maxX: Math.max(...probed.map((p) => p.x)),
    minY: Math.min(...probed.map((p) => p.y)),
    maxY: Math.max(...probed.map((p) => p.y)),
  };

  const fitW = CARD_WIDTH - FIT_PAD * 2;
  const fitH = CARD_HEIGHT - FIT_PAD * 2;
  bounds = expandTo(bounds, MIN_EXTENT_DEG, MIN_EXTENT_DEG * (fitH / fitW));

  const padX = (bounds.maxX - bounds.minX) * PAD_FRACTION;
  const padY = (bounds.maxY - bounds.minY) * PAD_FRACTION;
  bounds = {
    minX: bounds.minX - padX,
    maxX: bounds.maxX + padX,
    minY: bounds.minY - padY,
    maxY: bounds.maxY + padY,
  };

  const pxPerDeg = Math.min(fitW / (bounds.maxX - bounds.minX), fitH / (bounds.maxY - bounds.minY));

  const contentCx = (bounds.minX + bounds.maxX) / 2;
  const contentCy = (bounds.minY + bounds.maxY) / 2;
  const wcs = panelWcs(centre, pxPerDeg, {
    x: CARD_WIDTH / 2 - contentCx * pxPerDeg,
    y: CARD_HEIGHT / 2 - contentCy * pxPerDeg,
  });

  /* The graticule, before anything else, so the figure always sits over it.

     Meridians converge with declination, so a fixed spacing that suits Orion
     crowds Cassiopeia into stripes. Both spacings are therefore chosen from
     the field the card actually ended up covering. Under a gnomonic
     projection both families are curves, so each is sampled and drawn as a
     polyline rather than as a straight segment. */
  const corners = [
    pixelToSky(wcs, 0, 0),
    pixelToSky(wcs, CARD_WIDTH, 0),
    pixelToSky(wcs, CARD_WIDTH, CARD_HEIGHT),
    pixelToSky(wcs, 0, CARD_HEIGHT),
  ];
  const radiusDeg = Math.max(
    ...corners.map((c) => angularSeparation(centre.ra, centre.dec, c.ra, c.dec)),
  );

  const widthDeg = CARD_WIDTH / pxPerDeg;
  const heightDeg = CARD_HEIGHT / pxPerDeg;
  const cosDec = Math.max(0.08, Math.cos((centre.dec * Math.PI) / 180));

  const decStep = stepFor(heightDeg, DEC_STEPS, GRID_TARGET_LINES);
  const raStep = stepFor(widthDeg / cosDec / 15, RA_STEPS_HOURS, GRID_TARGET_LINES) * 15;

  const decLo = Math.max(-89.5, centre.dec - radiusDeg - decStep);
  const decHi = Math.min(89.5, centre.dec + radiusDeg + decStep);
  const raReach = Math.min(180, radiusDeg / cosDec + raStep);

  const onCard = (p: PanelPoint) =>
    p.x >= 0 && p.x <= CARD_WIDTH && p.y >= 0 && p.y <= CARD_HEIGHT;

  /** Samples to polylines, keeping only runs that actually cross the card. */
  const gridLine = (samples: (PanelPoint | null)[]): string[] => {
    const out: string[] = [];
    let run: PanelPoint[] = [];
    const flush = () => {
      if (run.length >= 2 && run.some(onCard)) {
        out.push(`<polyline points="${run.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}"/>`);
      }
      run = [];
    };
    for (const p of samples) {
      if (!p) flush();
      else run.push(p);
    }
    flush();
    return out;
  };

  const grid: string[] = [];
  const gridLabels: string[] = [];

  const label = (x: number, y: number, text: string, anchor: string) =>
    `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}">${text}</text>`;

  // Meridians, on whole multiples of the step so the same sky always rules
  // the same way whichever card it appears on.
  for (let ra = 0; ra < 360; ra += raStep) {
    let offset = ((ra - centre.ra + 540) % 360) - 180;
    if (Math.abs(offset) > raReach) continue;
    offset = centre.ra + offset;
    const samples: (PanelPoint | null)[] = [];
    for (let d = decLo; d <= decHi + 1e-9; d += 0.5) samples.push(project(wcs, offset, d));
    grid.push(...gridLine(samples));

    // Labelled at the bottom, where a meridian leaves the card. Only whole
    // hours are named: the ruling may be finer than that, and two adjacent
    // meridians both reading "21H" would be worse than one unnamed line.
    if (!labelled || ra % 15 !== 0) continue;
    const visible = samples.filter((p): p is PanelPoint => p !== null && onCard(p));
    if (visible.length === 0) continue;
    const foot = visible.reduce((a, b) => (b.y > a.y ? b : a));
    if (foot.x < GRID_LABEL_MARGIN || foot.x > CARD_WIDTH - GRID_LABEL_MARGIN) continue;
    const y = Math.min(foot.y, CARD_HEIGHT - GRID_LABEL_INSET) - 10;
    gridLabels.push(label(foot.x, y, formatRaLabel(ra), "middle"));
  }

  // Parallels, labelled up the left edge.
  for (let d = Math.ceil(decLo / decStep) * decStep; d <= decHi; d += decStep) {
    if (Math.abs(d) > 89.5) continue;
    const samples: (PanelPoint | null)[] = [];
    const raSample = Math.max(0.25, raReach / 120);
    for (let o = -raReach; o <= raReach + 1e-9; o += raSample) {
      samples.push(project(wcs, centre.ra + o, d));
    }
    grid.push(...gridLine(samples));

    if (!labelled) continue;
    const visible = samples.filter((p): p is PanelPoint => p !== null && onCard(p));
    if (visible.length === 0) continue;
    const edge = visible.reduce((a, b) => (b.x < a.x ? b : a));
    if (edge.y < GRID_LABEL_MARGIN || edge.y > CARD_HEIGHT - GRID_LABEL_MARGIN) continue;
    const x = Math.max(edge.x, 0) + GRID_LABEL_INSET;
    gridLabels.push(label(x, edge.y - 10, formatDecLabel(d), "start"));
  }

  /* The figure's lines, so every star sits on top of the ones meeting it. */
  const polylines: string[] = [];
  for (const part of parts) {
    for (const line of part.lines) {
      let run: PanelPoint[] = [];
      const flush = () => {
        if (run.length >= 2) {
          polylines.push(
            `<polyline points="${run.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}"/>`,
          );
        }
        run = [];
      };
      for (const [ra, dec] of line) {
        const p = project(wcs, ra, dec);
        // A figure can reach onto the far hemisphere, where no projection
        // exists. Break the run there rather than joining across the gap.
        if (!p) flush();
        else run.push(p);
      }
      flush();
    }
  }

  /* The stars, faintest first, so a bright one is never overdrawn by the spike
     of a dimmer neighbour it happens to overlap. */
  const drawn: { p: PanelPoint; length: number }[] = [];
  for (const vertex of vertices.values()) {
    const p = project(wcs, vertex.ra, vertex.dec);
    if (!p) continue;
    drawn.push({ p, length: spikeLength(magnitudeAt(vertex) ?? DEFAULT_VMAG) });
  }
  drawn.sort((a, b) => a.length - b.length);

  const stars = drawn.map(({ p, length }) => star(p.x, p.y, length)).join("");

  /* The target. The same shape, so it belongs to the same sky; red and larger,
     so it is never mistaken for one of the stars it sits among.

     With no ground to hide behind, the figure is cut away around the marker by
     a mask rather than covered by an opaque disc — a disc would show up as a
     grey blot the moment the card is composited over anything. */
  const mark = project(wcs, target.ra, target.dec);
  const clearance = mark
    ? `<mask id="target-clearance" maskUnits="userSpaceOnUse" x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">` +
      `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#fff"/>` +
      `<circle cx="${f1(mark.x)}" cy="${f1(mark.y)}" r="${(TARGET_SPIKE * TARGET_CLEARANCE).toFixed(1)}" fill="#000"/>` +
      `</mask>`
    : "";
  const marker = mark ? `<g fill="${MARKER}">${star(mark.x, mark.y, TARGET_SPIKE)}</g>` : "";

  /* Both layers carry the same clearance, so the hole the marker punches
     lines up when they are stacked and the figure still clears its own
     surroundings when it is used on its own. */
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`;
  const masked = `<g${mark ? ' mask="url(#target-clearance)"' : ""}>`;

  return {
    figure: [
      open,
      clearance,
      masked,
      `<g fill="none" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${polylines.join("")}</g>`,
      `<g fill="${STAR}">${stars}</g>`,
      `</g>`,
      marker,
      `</svg>`,
    ].join(""),
    grid: [
      open,
      clearance,
      masked,
      `<g fill="none" stroke="${GRID_COLOR}" stroke-opacity="${GRID_OPACITY}" ` +
        `stroke-width="${GRID_WIDTH}">${grid.join("")}</g>`,
      `</g>`,
      // Outside the mask: a label chopped through by the target clearance
      // reads as a rendering fault rather than as deliberate.
      `<g fill="${GRID_COLOR}" fill-opacity="${GRID_LABEL_OPACITY}" ` +
        `font-family="${CARD_FONT_FAMILY}" font-size="${GRID_LABEL_SIZE}" ` +
        `letter-spacing="${GRID_LABEL_TRACKING}">${gridLabels.join("")}</g>`,
      `</svg>`,
    ].join(""),
  };
}

/* --------------------------------------------------------------------- run */

/** One frame's card, or the reason there isn't one. */
async function buildOne(
  row: AtlasFrameRow,
  outDir: string,
  labelled: boolean,
): Promise<CardOutcome> {
  const base: CardOutcome = { slug: row.slug, catalogId: row.catalogId, ok: false };

  const placed = targetOf(row);
  if (!placed) {
    return {
      ...base,
      message: "No plate solve, and the plate coordinates could not be read.",
    };
  }

  const found = figureFor(row.plateConstellation, placed.point);
  if (!found) return { ...base, message: "No constellation figure matched." };

  const layers = renderCardLayers(placed.point, found.figure, labelled);
  const write = (svg: string, name: string) =>
    sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, name));

  await Promise.all([
    write(layers.figure, `${row.slug}.png`),
    write(layers.grid, `${row.slug}${GRID_SUFFIX}.png`),
  ]);

  return {
    ...base,
    ok: true,
    constellation: found.figure.name,
    matchedByName: found.matched,
    ra: placed.point.ra,
    dec: placed.point.dec,
    positionSource: placed.source,
  };
}

/**
 * Renders every published frame's card, or one frame's when `slug` is given.
 *
 * The whole set runs inside a single call, unlike the media re-derive next to
 * it in the admin. That loop has to be driven from the browser because each
 * frame is seconds of sharp on a 21 MP master; a card is a small SVG rasterised
 * once, so the entire log finishes well inside one request and there is nothing
 * to gain from making the author click through it.
 */
export async function buildConstellationCards(opts?: {
  outDir?: string;
  slug?: string;
}): Promise<CardRun> {
  const outDir = opts?.outDir ?? CARDS_ROOT;
  const rows = (await listAtlasFrames()).filter((r) => !opts?.slug || r.slug === opts.slug);

  // Before the first glyph is drawn in this process, and never after.
  const labelled = await ensureCardFonts();

  await fs.mkdir(outDir, { recursive: true });

  const results: CardOutcome[] = [];
  for (const row of rows) {
    try {
      results.push(await buildOne(row, outDir, labelled));
    } catch (error) {
      console.error(`[astroblog] Constellation card failed for "${row.slug}".`, error);
      results.push({
        slug: row.slug,
        catalogId: row.catalogId,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return { outDir, written: results.filter((r) => r.ok).length, labelled, results };
}

/** Where one frame's figure layer is written. */
export function constellationCardFile(slug: string): string {
  return path.join(CARDS_ROOT, `${slug}.png`);
}

/** Where its graticule layer is written. */
export function constellationGridFile(slug: string): string {
  return path.join(CARDS_ROOT, `${slug}${GRID_SUFFIX}.png`);
}

export type CardImage = {
  /** The figure and its marker, with no ruling on it. */
  src: string;
  /** The graticule alone, to lay behind the figure. Null if it is missing. */
  gridSrc: string | null;
  width: number;
  height: number;
};

/**
 * The card for one frame, or null when it has not been generated.
 *
 * Null is an ordinary outcome, not an error: cards are built on demand from the
 * admin, so a newly published frame has none until someone asks for it, and the
 * article simply omits the panel until then.
 *
 * The URL carries the file's modification time so that regenerating a card
 * reaches browsers that already cached the old one — the path never changes,
 * and the media route sends an hour of `max-age`.
 */
export async function findConstellationCard(slug: string): Promise<CardImage | null> {
  const stamped = async (file: string, name: string): Promise<string | null> => {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return null;
      return `${mediaUrl(`${CARDS_MEDIA_PREFIX}/${name}`)}?v=${Math.floor(stat.mtimeMs)}`;
    } catch {
      return null;
    }
  };

  const src = await stamped(constellationCardFile(slug), `${slug}.png`);
  if (!src) return null;

  // The grid is optional on purpose: a card generated before the layers were
  // split has no grid file, and the figure alone is still worth showing.
  const gridSrc = await stamped(constellationGridFile(slug), `${slug}${GRID_SUFFIX}.png`);
  return { src, gridSrc, width: CARD_WIDTH, height: CARD_HEIGHT };
}

/** What the cards directory holds against what the log now contains. */
export async function constellationCardStatus(): Promise<CardStatus> {
  const rows = await listAtlasFrames();
  const slugs = new Set(rows.map((r) => r.slug));

  let files: string[] = [];
  try {
    files = (await fs.readdir(CARDS_ROOT)).filter((f) => f.endsWith(".png"));
  } catch {
    // No directory yet simply means nothing has been generated.
  }
  // Grid layers are counted through their figure, never on their own —
  // otherwise every card would also report a stray "<slug>-grid" orphan.
  const onDisk = new Set(
    files
      .map((f) => f.slice(0, -".png".length))
      .filter((name) => !name.endsWith(GRID_SUFFIX)),
  );

  return {
    outDir: CARDS_ROOT,
    frames: rows.length,
    present: rows.filter((r) => onDisk.has(r.slug)).length,
    missing: rows.filter((r) => !onDisk.has(r.slug)).map((r) => r.slug),
    orphaned: [...onDisk].filter((s) => !slugs.has(s)).sort(),
  };
}
