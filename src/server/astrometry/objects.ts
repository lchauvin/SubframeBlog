import type { RawAnnotation } from "./client";

/**
 * Turns the solver's raw object list into the handful of deep-sky markers the
 * design calls for. A wide field routinely solves to 30+ objects, most of them
 * stars; the reference screen shows five.
 */

/** Stellar annotation types. Excluded — the design marks sky objects, not stars. */
const STELLAR_TYPES = new Set(["hd", "hip", "tycho2", "bright", "star", "2mass", "ppmxl"]);

/** Nominal image width the `radiusPx` unit is expressed against. */
const DESIGN_WIDTH = 1600;

/** Keeps circles readable: never a dot, never swallowing the frame. */
const MIN_RADIUS = 16;
const MAX_RADIUS = 120;

/** Preference order when an object carries several catalogue designations. */
const NAME_PRIORITY = [
  /^M \d+$/i, // Messier
  /^NGC \d+/i,
  /^IC \d+/i,
  /^Sh2-\d+/i, // Sharpless
  /^LBN \d+/i,
  /^LDN \d+/i,
  /^Barnard \d+/i,
  /^Caldwell \d+/i,
];

/** Canonical capitalisation for the catalogues that reach the page. */
const PREFIX_CASE: Record<string, string> = {
  m: "M",
  ngc: "NGC",
  ic: "IC",
  lbn: "LBN",
  ldn: "LDN",
  vdb: "vdB",
  barnard: "Barnard",
  caldwell: "Caldwell",
  abell: "Abell",
  ced: "Ced",
  cr: "Cr",
  mel: "Mel",
  ugc: "UGC",
  pgc: "PGC",
};

/** Normalises spacing so labels read like the design ("NGC 6888", not "NGC6888"). */
function tidy(name: string): string {
  const s = name.trim().replace(/\s+/g, " ");

  // Sharpless first: the "2" is part of the catalogue name (Sharpless 2nd
  // edition), not the object number, so it must NOT be split off as a digit.
  const sharpless =
    /^sh\s*2\s*[-–—\s]\s*(\d+)$/i.exec(s) ?? /^sharpless\s*[-\s]?\s*(\d+)$/i.exec(s);
  if (sharpless) return `Sh2-${sharpless[1]}`;

  const parts = /^([A-Za-z]+)\s*[-\s]?\s*(\d.*)$/.exec(s);
  if (parts) {
    const canonical = PREFIX_CASE[parts[1].toLowerCase()];
    if (canonical) return `${canonical} ${parts[2].trim()}`;
  }
  return s;
}

export function pickName(names: string[]): string {
  const cleaned = names.map(tidy).filter(Boolean);
  if (cleaned.length === 0) return "";
  for (const pattern of NAME_PRIORITY) {
    const hit = cleaned.find((n) => pattern.test(n));
    if (hit) return hit;
  }
  return cleaned[0];
}

export type SelectedAnnotation = {
  label: string;
  xPct: number;
  yPct: number;
  radiusPx: number;
};

export function selectAnnotations(
  raw: RawAnnotation[],
  submitted: { width: number; height: number },
  limit = 8,
): { selected: SelectedAnnotation[]; consideredCount: number } {
  if (!submitted.width || !submitted.height) {
    return { selected: [], consideredCount: 0 };
  }

  const deepSky = raw.filter((a) => !STELLAR_TYPES.has(a.type.toLowerCase()));

  const mapped = deepSky
    .map((a) => {
      const xPct = (a.pixelx / submitted.width) * 100;
      const yPct = (a.pixely / submitted.height) * 100;
      // Radius arrives in submitted-image pixels; express it as a fraction of
      // image width, then in the design's nominal-1600px unit.
      const fraction = a.radius / submitted.width;
      return {
        label: pickName(a.names),
        xPct,
        yPct,
        radiusPx: Math.round(
          Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, fraction * DESIGN_WIDTH)),
        ),
        // Rank on true angular size, before clamping flattens the big ones.
        weight: fraction,
      };
    })
    // Solvers report objects whose centres sit just outside the frame; a marker
    // for something you cannot see is noise.
    .filter((a) => a.label && a.xPct >= 0 && a.xPct <= 100 && a.yPct >= 0 && a.yPct <= 100);

  // De-duplicate: the same object can appear under several catalogues.
  const seen = new Set<string>();
  const unique = mapped.filter((a) => {
    const key = a.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const selected = unique
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ label, xPct, yPct, radiusPx }) => ({
      label,
      xPct: Number(xPct.toFixed(2)),
      yPct: Number(yPct.toFixed(2)),
      radiusPx,
    }));

  return { selected, consideredCount: deepSky.length };
}
