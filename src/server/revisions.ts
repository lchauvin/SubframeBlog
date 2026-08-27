import "server-only";

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

const gearSignature = (rows: { keyLabel: string; value: string }[]) =>
  rows
    .map((r) => `${r.keyLabel.trim().toLowerCase()}=${r.value.trim().toLowerCase()}`)
    .sort()
    .join("|");

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

  // When the scale is known and unchanged, it overrules differing gear text:
  // the optical train demonstrably did not change, whatever the labels say.
  const rigChanged = scaleChanged || (gearChanged && !bothSolved);

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

  const derived: RevisionKind = rigChanged
    ? "new-rig"
    : paletteChanged
      ? "new-palette"
      : moreData || filtersChanged
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
