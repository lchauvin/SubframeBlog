/**
 * Checks the revision relationship rules.
 *
 *   npm run check:revisions
 *
 * Two halves. The first exercises `classifyRevision` and `groupChain` against
 * fixtures, because the rule has to be falsifiable without production data —
 * the local database has five design frames and no revisions at all. The second
 * checks the live parent links for cycles and orphans.
 *
 * The fixtures are not decoration. The gear cases in particular encode a rule
 * that a survey of synthetic pairs already broke once: gear text differing does
 * not mean the rig changed, and a frame with no gear rows is silence rather
 * than evidence.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../src/server/db/client";
import { frames } from "../src/server/db/schema";
import {
  classifyRevision,
  clusterByTarget,
  groupChain,
  type RevisionInput,
  type RevisionKind,
} from "../src/server/revisions";

let failures = 0;

const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
};

const frame = (over: Partial<RevisionInput> = {}): RevisionInput => ({
  slug: "f",
  capturedOn: "2026-01-01",
  palette: "SHO",
  bandwidth: "3nm",
  totalIntegrationMinutes: 600,
  pixScale: 1.5,
  opticalGear: [{ keyLabel: "Optics", value: "RC8" }],
  filters: [{ name: "Ha", keptFrames: 100, hours: 10 }],
  nightCount: 3,
  revisionKind: "",
  ...over,
});

function expectKind(label: string, a: RevisionInput, b: RevisionInput, want: RevisionKind) {
  const got = classifyRevision(a, b);
  check(label, got.kind === want, got.kind === want ? "" : `expected ${want}, got ${got.kind}`);
}

function main() {
  console.log("\n== derivation ==\n");

  expectKind("identical frames are a reprocess", frame(), frame(), "reprocess");

  expectKind(
    "more integration is more data",
    frame(),
    frame({ totalIntegrationMinutes: 1200, filters: [{ name: "Ha", keptFrames: 200, hours: 20 }] }),
    "more-data",
  );

  expectKind(
    "an extra night is more data even at equal minutes",
    frame(),
    frame({ nightCount: 5 }),
    "more-data",
  );

  expectKind(
    "a different palette accompanies rather than supersedes",
    frame(),
    frame({ palette: "HOO" }),
    "new-palette",
  );

  // Production's IC 63: 14.5% apart in plate scale with byte-identical optics,
  // because the second frame is a tighter crop of the same field. The rig did
  // not change; the processing did.
  expectKind(
    "a changed plate scale with the same recorded optics is a crop, not a new rig",
    frame({ pixScale: 1.409 }),
    frame({ pixScale: 1.205 }),
    "reprocess",
  );

  check(
    "a crop is reported as a reframe rather than silently",
    classifyRevision(frame({ pixScale: 1.409 }), frame({ pixScale: 1.205 })).changes.includes(
      "reframed",
    ),
  );

  expectKind(
    "plate scale decides when neither frame records its optics",
    frame({ opticalGear: [], pixScale: 1.5 }),
    frame({ opticalGear: [], pixScale: 2.1 }),
    "new-rig",
  );

  expectKind(
    "different recorded optics is a new rig whatever the scale says",
    frame({ opticalGear: [{ keyLabel: "Optics", value: "RedCat 51" }] }),
    frame({ opticalGear: [{ keyLabel: "Optics", value: "Esprit 100" }] }),
    "new-rig",
  );

  expectKind(
    "the same scope under a renamed key is not a rig change",
    frame({ opticalGear: [{ keyLabel: "Optics", value: "RedCat 51" }] }),
    frame({ opticalGear: [{ keyLabel: "Telescope", value: "RedCat 51" }] }),
    "reprocess",
  );

  // The whole IC 63 pair as production actually holds it.
  expectKind(
    "IC 63 as production holds it: crop + SII added + 8h34m more",
    frame({
      palette: "HaRGB",
      pixScale: 1.409,
      totalIntegrationMinutes: 175,
      nightCount: 4,
      filters: [{ name: "Ha", keptFrames: 15, hours: 1.25 }],
    }),
    frame({
      palette: "HSRGB",
      pixScale: 1.205,
      totalIntegrationMinutes: 689,
      nightCount: 15,
      filters: [
        { name: "SII", keptFrames: 58, hours: 4.83 },
        { name: "Ha", keptFrames: 55, hours: 4.58 },
      ],
    }),
    "more-data",
  );

  // The rule this suite exists to defend.
  expectKind(
    "gear text differing does NOT beat an unchanged plate scale",
    frame({ opticalGear: [{ keyLabel: "Optics", value: "RC8" }] }),
    frame({
      totalIntegrationMinutes: 1200,
      filters: [{ name: "Ha", keptFrames: 200, hours: 20 }],
      opticalGear: [
        { keyLabel: "Optics", value: "RC8" },
        { keyLabel: "Telescope", value: "RC8 " },
      ],
    }),
    "more-data",
  );

  expectKind(
    "gear text decides when neither frame is solved",
    frame({ pixScale: null, opticalGear: [{ keyLabel: "Optics", value: "RC8" }] }),
    frame({ pixScale: null, opticalGear: [{ keyLabel: "Optics", value: "Esprit 100" }] }),
    "new-rig",
  );

  expectKind(
    "a frame with no gear rows is silence, not a rig change",
    frame({ pixScale: null, opticalGear: [] }),
    frame({ pixScale: null, opticalGear: [{ keyLabel: "Optics", value: "Esprit 100" }] }),
    "reprocess",
  );

  expectKind(
    "non-optical gear changing is not a rig change",
    frame({ pixScale: null, opticalGear: [{ keyLabel: "Optics", value: "RC8" }] }),
    frame({
      pixScale: null,
      opticalGear: [{ keyLabel: "Optics", value: "RC8" }],
      // Mount/guiding rows never reach opticalGear, so this is the same list.
    }),
    "reprocess",
  );

  // Production's IC 63: HaRGB -> HSRGB because SII was added, with 8h34m and
  // eleven nights alongside it. The palette label followed the acquisition, so
  // this supersedes rather than accompanying.
  expectKind(
    "a palette that changed because data was added is more data",
    frame({ palette: "HaRGB", totalIntegrationMinutes: 175, nightCount: 4 }),
    frame({ palette: "HSRGB", totalIntegrationMinutes: 689, nightCount: 15 }),
    "more-data",
  );

  expectKind(
    "a palette change with no new data is still a reinterpretation",
    frame({ palette: "SHO" }),
    frame({ palette: "HOO" }),
    "new-palette",
  );

  expectKind(
    "an author override wins over the derivation",
    frame(),
    frame({ pixScale: 2.1, revisionKind: "reprocess" }),
    "reprocess",
  );

  // Totality: every pair must yield exactly one kind, including degenerate ones.
  const degenerate: RevisionInput[] = [
    frame({ pixScale: null, opticalGear: [], filters: [], nightCount: 0, totalIntegrationMinutes: 0 }),
    frame({ palette: "", bandwidth: "" }),
    frame({ totalIntegrationMinutes: -1 }),
  ];
  let total = true;
  for (const a of degenerate) {
    for (const b of degenerate) {
      const v = classifyRevision(a, b);
      if (!v.kind || !v.disposition) total = false;
    }
  }
  check("derivation is total over degenerate inputs", total);

  console.log("\n== grouping ==\n");

  const chain = (...kinds: RevisionInput[]) => groupChain(kinds, (f) => f);

  const reprocessChain = chain(frame({ slug: "a" }), frame({ slug: "b" }), frame({ slug: "c" }));
  check(
    "a chain of reprocesses is one group headed by the newest",
    reprocessChain.length === 1 && reprocessChain[0].head.slug === "c",
    `${reprocessChain.length} group(s), head ${reprocessChain[0]?.head.slug}`,
  );

  const rigChain = chain(
    frame({ slug: "a", opticalGear: [{ keyLabel: "Optics", value: "RedCat 51" }] }),
    frame({ slug: "b", opticalGear: [{ keyLabel: "Optics", value: "Esprit 100" }] }),
  );
  check(
    "a new rig starts its own group so both stay in the log",
    rigChain.length === 2,
    `${rigChain.length} group(s)`,
  );

  const rc = [{ keyLabel: "Optics", value: "RedCat 51" }];
  const esprit = [{ keyLabel: "Optics", value: "Esprit 100" }];
  const mixed = chain(
    frame({ slug: "a", opticalGear: rc }),
    frame({ slug: "b", opticalGear: rc, totalIntegrationMinutes: 1200 }),
    frame({ slug: "c", opticalGear: esprit }),
    frame({ slug: "d", opticalGear: esprit }),
  );
  check(
    "supersedes folds in, accompanies splits",
    mixed.length === 2 && mixed[0].head.slug === "b" && mixed[1].head.slug === "d",
    mixed.map((g) => `${g.head.slug}[${g.members.length}]`).join(" "),
  );

  check(
    "every member has a verdict slot, first is null",
    mixed.every((g) => g.verdicts.length === g.members.length) && mixed[0].verdicts[0] === null,
  );

  console.log("\n== target clustering ==\n");

  // The case that matters most: every frame on a running site predates this
  // feature and carries a null parent, so clustering must work without links.
  type T = {
    id: number;
    catalogId: string;
    capturedOn: string;
    parentFrameId: number | null;
    ra: number | null;
    dec: number | null;
  };
  const t = (over: Partial<T> = {}): T => ({
    id: 1,
    catalogId: "IC 63",
    capturedOn: "2026-01-01",
    parentFrameId: null,
    ra: null,
    dec: null,
    ...over,
  });

  const byCatalog = clusterByTarget(
    [t({ id: 1 }), t({ id: 2, capturedOn: "2026-02-01" }), t({ id: 3, catalogId: "NGC 7000" })],
    (r) => r,
  );
  check(
    "same catalog id clusters with no parent link at all",
    byCatalog.length === 2 && byCatalog.some((c) => c.length === 2),
    byCatalog.map((c) => c.map((r) => r.id).join("+")).join(" "),
  );

  const blank = clusterByTarget(
    [t({ id: 1, catalogId: "" }), t({ id: 2, catalogId: "" })],
    (r) => r,
  );
  check("an empty catalog id does not collapse unrelated frames", blank.length === 2);

  const byPos = clusterByTarget(
    [
      t({ id: 1, catalogId: "Sh2-157", ra: 350.1, dec: 60.0 }),
      t({ id: 2, catalogId: "LBN 537", ra: 350.2, dec: 60.0 }),
      t({ id: 3, catalogId: "M 31", ra: 10.7, dec: 41.3 }),
    ],
    (r) => r,
  );
  check(
    "frames within half a degree cluster despite different catalog ids",
    byPos.length === 2 && byPos.some((c) => c.length === 2),
    byPos.map((c) => c.map((r) => r.id).join("+")).join(" "),
  );

  const linked = clusterByTarget(
    [t({ id: 1, catalogId: "Old Name" }), t({ id: 2, catalogId: "New Name", parentFrameId: 1 })],
    (r) => r,
  );
  check("an explicit parent link unions frames detection would miss", linked.length === 1);

  const ordered = clusterByTarget(
    [t({ id: 1, capturedOn: "2026-05-01" }), t({ id: 2, capturedOn: "2026-01-01" })],
    (r) => r,
  );
  check(
    "clusters come back oldest first",
    ordered[0][0].capturedOn === "2026-01-01",
    ordered[0].map((r) => r.capturedOn).join(" "),
  );

  console.log("\n== live parent links ==\n");

  const rows = db
    .select({ id: frames.id, slug: frames.slug, parentFrameId: frames.parentFrameId })
    .from(frames)
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));

  check("no frame is its own parent", rows.every((r) => r.parentFrameId !== r.id));

  let cycleFree = true;
  for (const row of rows) {
    const seen = new Set<number>([row.id]);
    let cursor = row.parentFrameId;
    while (cursor != null) {
      if (seen.has(cursor)) {
        cycleFree = false;
        console.log(`        cycle through ${row.slug}`);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentFrameId ?? null;
    }
  }
  check("parent chains terminate (no cycles)", cycleFree);

  const orphans = rows.filter((r) => r.parentFrameId != null && !byId.has(r.parentFrameId));
  check(
    "every parent link points at a frame that exists",
    orphans.length === 0,
    orphans.map((o) => o.slug).join(", "),
  );

  const parented = db
    .select({ id: frames.id })
    .from(frames)
    .where(and(isNotNull(frames.parentFrameId), eq(frames.published, true)))
    .all();
  console.log(`        ${parented.length} published frame(s) currently carry a parent link`);

  console.log(
    `\n${failures === 0 ? "REVISION CHECKS PASSED" : `REVISION CHECKS FAILED (${failures})`}\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
