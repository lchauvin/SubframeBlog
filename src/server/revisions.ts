import "server-only";

import { angularSeparation } from "./astrometry/wcs";

/**
 * Typing the relationship between two processings of the same target.
 *
 * A "revision" is three different things wearing one word — a reprocess of the
 * same subs, the same target with more integration, or a different rig
 * altogether — and collapsing all three into one log row loses the distinction
 * that makes them worth showing. So the kind is derived here, from data that is
 * already stored, and the kind decides whether the pair collapses.
 *
 * Nothing in this file reads the database. It takes plain rows so the rule can
 * be exercised against fixtures and against production (`npm run
 * survey:revisions`) without a server.
 */

export type RevisionKind = "reprocess" | "more-data" | "new-palette" | "new-rig";

export const REVISION_KINDS: RevisionKind[] = [
  "reprocess",
  "more-data",
  "new-palette",
  "new-rig",
];

/** Whether the newer frame replaces the older one in the log, or sits beside it. */
export type Disposition = "supersedes" | "accompanies";

export const DISPOSITION: Record<RevisionKind, Disposition> = {
  reprocess: "supersedes",
  "more-data": "supersedes",
  "new-palette": "accompanies",
  "new-rig": "accompanies",
};

export const KIND_LABEL: Record<RevisionKind, string> = {
  reprocess: "Reprocessed",
  "more-data": "More data",
  "new-palette": "New palette",
  "new-rig": "New rig",
};

/** Everything the rule looks at, for one frame. */
export type RevisionInput = {
  slug: string;
  capturedOn: string;
  palette: string;
  bandwidth: string;
  totalIntegrationMinutes: number;
  /** From `plate_solves.pix_scale` — measured, not typed. Null when unsolved. */
  pixScale: number | null;
  /** Only the rows that describe the optical train. See `OPTICAL_KEYS`. */
  opticalGear: { keyLabel: string; value: string }[];
  filters: { name: string; keptFrames: number; hours: number }[];
  nightCount: number;
  /** Author override; empty means derive. */
  revisionKind: string;
};

/**
 * Gear keys that change what the image *is*, rather than how it was guided or
 * mounted. A different mount produces the same photograph; a different scope
 * does not.
 */
const OPTICAL_KEYS = ["optic", "telescope", "scope", "lens", "camera", "sensor", "reducer",
  "flattener", "barlow"];

/** 2% — comfortably inside a solver's run-to-run variation, well under any real change. */
const SCALE_TOLERANCE = 0.02;

const isOpticalKey = (label: string) => {
  const k = label.toLowerCase();
  return OPTICAL_KEYS.some((needle) => k.includes(needle));
};

export const opticalGearOf = <T extends { keyLabel: string; value: string }>(rows: T[]): T[] =>
  rows.filter((r) => isOpticalKey(r.keyLabel));

/**
 * The set of optical *values*, ignoring which key each sat under.
 *
 * Keys drift where the equipment does not: the same scope gets listed as
 * "Optics" on one frame and "Telescope" on another, or appears twice. Comparing
 * key=value pairs turns that into a phantom rig change, while comparing the set
 * of values still catches a genuinely different scope or camera.
 */
const gearSignature = (rows: { keyLabel: string; value: string }[]) =>
  [...new Set(rows.map((r) => r.value.trim().toLowerCase()).filter(Boolean))].sort().join("|");

const filterSignature = (rows: { name: string; keptFrames: number; hours: number }[]) =>
  rows
    .map((r) => `${r.name.trim().toLowerCase()}:${r.keptFrames}:${r.hours}`)
    .sort()
    .join("|");

export type RevisionVerdict = {
  kind: RevisionKind;
  disposition: Disposition;
  /** True when an author override produced it rather than the rule. */
  overridden: boolean;
  /** Short human-readable deltas, for the article's revision rail. */
  changes: string[];
};

/**
 * Classifies `next` relative to `prev` — its immediate parent, never further
 * back.
 *
 * Deliberately not transitive: in an A -> B -> C chain, B->C is judged against
 * B alone. Computing what C is to A produces confident nonsense, because a
 * chain ordered by capture date can perfectly well reprocess something that
 * gained data two hops earlier, and the middle hop is not evidence about the
 * ends.
 */
export function classifyRevision(prev: RevisionInput, next: RevisionInput): RevisionVerdict {
  const changes: string[] = [];

  const override = REVISION_KINDS.find((k) => k === next.revisionKind);

  // Plate scale first, and it outranks the gear text.
  //
  // Gear rows are a per-frame copy of the current rig, so they drift for
  // reasons that have nothing to do with changing equipment: an edited rig
  // list, a duplicated row, a frame authored before per-frame gear existed.
  // Surveying synthetic pairs, a frame that had gained ten hours on the same
  // optics was classified "new rig" purely because one side carried an extra
  // identical-looking row. Scale is measured from the sky and cannot drift that
  // way, so where it exists it decides.
  const bothSolved = prev.pixScale !== null && next.pixScale !== null && prev.pixScale > 0;
  const scaleChanged =
    bothSolved &&
    Math.abs((next.pixScale as number) - (prev.pixScale as number)) / (prev.pixScale as number) >
      SCALE_TOLERANCE;

  const prevGear = gearSignature(prev.opticalGear);
  const nextGear = gearSignature(next.opticalGear);
  // A frame with no gear rows is silence, not evidence of a change.
  const bothHaveGear = prevGear.length > 0 && nextGear.length > 0;
  const gearChanged = bothHaveGear && prevGear !== nextGear;

  /**
   * Recorded optics decide; plate scale is only the fallback.
   *
   * Scale looked like the honest signal — measured from the sky rather than
   * typed — but it is not a property of the rig alone. Cropping in processing
   * and exporting at the same pixel dimensions changes arcsec/px while the
   * telescope sits untouched. Production has exactly that: IC 63's two frames
   * differ 14.5% in plate scale with byte-identical optics and camera, because
   * the second is a tighter crop of the same field. Sh2-157's differ by 0.17%.
   * Treating scale as authoritative called the crop a new rig and kept two rows
   * in the log for one photograph.
   *
   * So where both frames record their optics, that is the answer; scale only
   * speaks when they do not.
   */
  const rigChanged = bothHaveGear ? gearChanged : scaleChanged;

  const paletteChanged =
    prev.palette.trim().toLowerCase() !== next.palette.trim().toLowerCase() ||
    prev.bandwidth.trim().toLowerCase() !== next.bandwidth.trim().toLowerCase();

  const filtersChanged = filterSignature(prev.filters) !== filterSignature(next.filters);
  const gainedMinutes = next.totalIntegrationMinutes - prev.totalIntegrationMinutes;
  const moreData = gainedMinutes > 0 || next.nightCount > prev.nightCount;

  if (rigChanged) {
    changes.push(
      scaleChanged && bothSolved
        ? `${(prev.pixScale as number).toFixed(2)}″/px → ${(next.pixScale as number).toFixed(2)}″/px`
        : "different optics",
    );
  } else if (scaleChanged) {
    // Same rig, different sky per pixel: the frame was cropped or reframed in
    // processing. Worth showing — it is why the two images do not overlay.
    changes.push("reframed");
  }
  if (paletteChanged) {
    const a = [prev.palette, prev.bandwidth].filter(Boolean).join(" ");
    const b = [next.palette, next.bandwidth].filter(Boolean).join(" ");
    if (a !== b) changes.push(`${a || "—"} → ${b || "—"}`);
  }
  if (gainedMinutes !== 0) {
    const sign = gainedMinutes > 0 ? "+" : "−";
    const abs = Math.abs(gainedMinutes);
    changes.push(`${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`);
  }
  if (next.nightCount > prev.nightCount) {
    changes.push(`+${next.nightCount - prev.nightCount} night${next.nightCount - prev.nightCount === 1 ? "" : "s"}`);
  }

  /**
   * More data outranks a changed palette, which is the opposite of what the
   * first version of this did.
   *
   * "New palette" means the same subs mapped differently — an interpretation
   * rather than a correction, which is why it accompanies instead of
   * superseding. But a palette label also changes when a *new filter* is
   * added, and then it is describing acquisition, not interpretation. IC 63 in
   * production is exactly that: HaRGB to HSRGB, because SII was added, along
   * with 8h34m and eleven nights. Reading that as a reinterpretation left two
   * rows in the log where the newer one plainly supersedes the older.
   *
   * So the palette only decides when the data behind it did not move.
   */
  const derived: RevisionKind = rigChanged
    ? "new-rig"
    : moreData
      ? "more-data"
      : paletteChanged
        ? "new-palette"
        : filtersChanged
          ? "more-data"
          : "reprocess";

  const kind = override ?? derived;
  return {
    kind,
    disposition: DISPOSITION[kind],
    overridden: Boolean(override),
    changes,
  };
}

/**
 * One target and every processing of it, oldest first.
 *
 * `head` is the frame the log shows. It is the newest frame that supersedes
 * everything before it; a frame that only *accompanies* its parent — a
 * different rig, a different palette — is not a replacement for it, so it gets
 * its own group and its own row in the log.
 */
export type RevisionGroup<T> = {
  head: T;
  members: T[];
  /** Verdict for each member against its parent. Same order as `members`. */
  verdicts: (RevisionVerdict | null)[];
};

/**
 * Splits one parent chain into log groups.
 *
 * A chain is every frame linked by `parentFrameId`, sorted oldest first. It
 * becomes one group per "accompanies" hop: superseding frames fold into the
 * group they extend, accompanying frames start a new one. So a target shot
 * twice on the same rig and then reprocessed is one row, while the same target
 * later shot on a different scope is two.
 */
export function groupChain<T>(
  chain: T[],
  read: (frame: T) => RevisionInput,
): RevisionGroup<T>[] {
  if (chain.length === 0) return [];

  const groups: RevisionGroup<T>[] = [];
  let current: RevisionGroup<T> = { head: chain[0], members: [chain[0]], verdicts: [null] };

  for (let i = 1; i < chain.length; i++) {
    const verdict = classifyRevision(read(chain[i - 1]), read(chain[i]));

    if (verdict.disposition === "supersedes") {
      current.members.push(chain[i]);
      current.verdicts.push(verdict);
      current.head = chain[i];
    } else {
      groups.push(current);
      current = { head: chain[i], members: [chain[i]], verdicts: [verdict] };
    }
  }

  groups.push(current);
  return groups;
}

/** Identity signals for deciding two frames are the same target. */
export type TargetRow = {
  id: number;
  catalogId: string;
  capturedOn: string;
  parentFrameId: number | null;
  /** Solved centre, when there is one. */
  ra: number | null;
  dec: number | null;
};

/** Same threshold the sky atlas uses to call two footprints one target. */
const SAME_TARGET_DEG = 0.5;

const normId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Groups frames that are processings of the same target.
 *
 * Detection rather than bookkeeping, deliberately. `parentFrameId` is only ever
 * set when a *new* frame collides on a slug, so every frame that existed before
 * revisions did carries a null parent — which is all of them on a running site.
 * Requiring the link would mean the feature only ever applied to content created
 * after it shipped, and would need a backfill on every deployment that has
 * history. The sky atlas already answers "are these the same target?" from
 * catalog id and solved position, and that answer is available for frames nobody
 * has touched.
 *
 * An explicit parent link still wins where it exists: it unions two frames whose
 * catalog ids and positions would not have matched — a renamed target, a frame
 * with no solve — which is exactly the case detection cannot cover.
 */
export function clusterByTarget<T>(rows: T[], read: (row: T) => TargetRow): T[][] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent[rb] = ra;
  };

  const info = rows.map(read);
  const indexById = new Map(info.map((r, i) => [r.id, i]));

  for (let i = 0; i < rows.length; i++) {
    // An author-set link is authoritative.
    const linked = info[i].parentFrameId;
    if (linked != null && indexById.has(linked)) union(indexById.get(linked)!, i);

    for (let j = i + 1; j < rows.length; j++) {
      const a = info[i];
      const b = info[j];

      // An empty catalog id must not collapse every unnamed frame together.
      const idA = normId(a.catalogId);
      const idB = normId(b.catalogId);
      if (idA && idA === idB) {
        union(i, j);
        continue;
      }

      if (a.ra !== null && a.dec !== null && b.ra !== null && b.dec !== null) {
        if (angularSeparation(a.ra, a.dec, b.ra, b.dec) <= SAME_TARGET_DEG) union(i, j);
      }
    }
  }

  const buckets = new Map<number, T[]>();
  rows.forEach((row, i) => {
    const key = find(i);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  });

  // Oldest first — the chain reads forwards in time, and `groupChain` judges
  // each frame against the one before it.
  return [...buckets.values()].map((bucket) =>
    bucket.sort((x, y) => {
      const a = read(x);
      const b = read(y);
      if (a.capturedOn !== b.capturedOn) return a.capturedOn < b.capturedOn ? -1 : 1;
      return a.id - b.id;
    }),
  );
}
