/**
 * Reports which frames are revisions of the same target, and how they differ.
 *
 *   npm run survey:revisions
 *   ASTROBLOG_DATA_DIR=... npm run survey:revisions
 *
 * Read-only. Nothing here writes, so it is safe against a production snapshot
 * or a live data directory.
 *
 * This exists to settle a design question before any of it is built: the plan
 * for grouping revisions assumes the *kind* of relationship between two frames
 * of one target can be derived by diffing what is already stored — gear,
 * filters, nights, palette, image scale — rather than hand-classified. That
 * assumption is only worth building on if real pairs actually separate cleanly
 * under it. Five local design frames cannot answer that; production can.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../src/server/db/client";
import {
  frameFilters,
  frameGear,
  frames,
  nights,
  plateSolves,
} from "../src/server/db/schema";
import { angularSeparation } from "../src/server/astrometry/wcs";

/** Same threshold the sky atlas uses to call two footprints the same target. */
const SAME_TARGET_DEG = 0.5;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Row = {
  id: number;
  slug: string;
  catalogId: string;
  commonName: string;
  revision: string;
  capturedOn: string;
  palette: string;
  bandwidth: string;
  minutes: number;
  arcsecPerPx: number | null;
  ra: number | null;
  dec: number | null;
};

function sameTarget(a: Row, b: Row): boolean {
  if (norm(a.catalogId) && norm(a.catalogId) === norm(b.catalogId)) return true;
  if (a.ra !== null && a.dec !== null && b.ra !== null && b.dec !== null) {
    return angularSeparation(a.ra, a.dec, b.ra, b.dec) <= SAME_TARGET_DEG;
  }
  return false;
}

const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

async function main() {
  const frameRows = db.select().from(frames).all();
  const solves = db.select().from(plateSolves).all();

  const rows: Row[] = frameRows.map((f) => {
    const solve = solves.find((s) => s.frameId === f.id && s.status === "solved");
    return {
      id: f.id,
      slug: f.slug,
      catalogId: f.catalogId,
      commonName: f.commonName,
      revision: f.revision,
      capturedOn: f.capturedOn,
      palette: f.palette,
      bandwidth: f.bandwidth,
      minutes: f.totalIntegrationMinutes,
      arcsecPerPx: f.arcsecPerPx,
      ra: solve?.centerRa ?? null,
      dec: solve?.centerDec ?? null,
    };
  });

  // Group by target, the same way the atlas already does for drawing.
  const groups: Row[][] = [];
  for (const row of rows) {
    const host = groups.find((g) => g.some((member) => sameTarget(member, row)));
    if (host) host.push(row);
    else groups.push([row]);
  }

  const multi = groups.filter((g) => g.length > 1);
  multi.forEach((g) =>
    g.sort((a, b) => (a.capturedOn < b.capturedOn ? -1 : a.capturedOn > b.capturedOn ? 1 : 0)),
  );

  console.log(`\n${rows.length} frames, ${groups.length} targets, ${multi.length} with revisions\n`);

  if (multi.length === 0) {
    console.log("No multi-frame targets in this database — run against production.\n");
  }

  for (const group of multi) {
    console.log("=".repeat(78));
    console.log(`${group[0].catalogId}${group[0].commonName ? ` — ${group[0].commonName}` : ""}`);
    console.log("=".repeat(78));

    for (const row of group) {
      const gear = db.select().from(frameGear).where(eq(frameGear.frameId, row.id)).all();
      const filters = db.select().from(frameFilters).where(eq(frameFilters.frameId, row.id)).all();
      const nightRows = db.select().from(nights).where(eq(nights.frameId, row.id)).all();

      console.log(
        `\n  ${row.slug}  rev="${row.revision}"  ${row.capturedOn}  ${hours(row.minutes)}` +
          `  ${row.palette}/${row.bandwidth}` +
          `  ${row.arcsecPerPx ? `${row.arcsecPerPx.toFixed(2)}"/px` : 'no "/px'}`,
      );
      console.log(
        `    gear    : ${gear.length ? gear.map((g) => `${g.keyLabel}=${g.value}`).join(" | ") : "(none)"}`,
      );
      console.log(
        `    filters : ${
          filters.length
            ? filters.map((f) => `${f.name} ${f.keptFrames}/${f.totalFrames} ${f.hours}h`).join(" | ")
            : "(none)"
        }`,
      );
      console.log(
        `    nights  : ${nightRows.length} row(s)` +
          (nightRows.length
            ? ` ${nightRows[0].nightDate} → ${nightRows[nightRows.length - 1].nightDate}`
            : ""),
      );
    }

    // The derivation the plan proposes, applied to each consecutive pair.
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const next = group[i];

      const gearOf = (id: number) =>
        db
          .select()
          .from(frameGear)
          .where(eq(frameGear.frameId, id))
          .all()
          .map((g) => `${g.keyLabel}=${g.value}`)
          .sort()
          .join("|");
      const filtersOf = (id: number) =>
        db
          .select()
          .from(frameFilters)
          .where(eq(frameFilters.frameId, id))
          .all()
          .map((f) => `${f.name}:${f.keptFrames}:${f.hours}`)
          .sort()
          .join("|");
      const nightCount = (id: number) =>
        db.select().from(nights).where(eq(nights.frameId, id)).all().length;

      const gearChanged = gearOf(prev.id) !== gearOf(next.id);
      const filtersChanged = filtersOf(prev.id) !== filtersOf(next.id);
      const moreData = next.minutes > prev.minutes || nightCount(next.id) > nightCount(prev.id);
      const paletteChanged =
        prev.palette !== next.palette || prev.bandwidth !== next.bandwidth;
      const scaleChanged =
        prev.arcsecPerPx !== null &&
        next.arcsecPerPx !== null &&
        Math.abs(prev.arcsecPerPx - next.arcsecPerPx) / prev.arcsecPerPx > 0.02;

      const kind = gearChanged || scaleChanged
        ? "NEW RIG        (accompanies — keep both in the log)"
        : paletteChanged
          ? "NEW PALETTE    (accompanies — keep both in the log)"
          : moreData || filtersChanged
            ? "MORE DATA      (supersedes — collapse)"
            : "REPROCESS      (supersedes — collapse)";

      console.log(
        `\n  ${prev.slug} → ${next.slug}: ${kind}` +
          `\n    gear ${gearChanged ? "differs" : "same"}` +
          ` · filters ${filtersChanged ? "differ" : "same"}` +
          ` · integration ${prev.minutes}→${next.minutes}min` +
          ` · palette ${paletteChanged ? "differs" : "same"}` +
          ` · scale ${scaleChanged ? "differs" : "same"}`,
      );
    }
    console.log();
  }

  // Slug collisions are the concrete symptom: two frames of one target both
  // deriving the same slug cannot both be imported.
  const bySlug = new Map<string, string[]>();
  for (const row of rows) {
    const key = norm(row.catalogId) + "|" + norm(row.revision);
    bySlug.set(key, [...(bySlug.get(key) ?? []), row.slug]);
  }
  const collisions = [...bySlug.entries()].filter(([, v]) => v.length > 1);
  if (collisions.length) {
    console.log("Catalog+revision pairs that would derive the same slug:");
    for (const [key, slugs] of collisions) console.log(`  ${key}: ${slugs.join(", ")}`);
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
