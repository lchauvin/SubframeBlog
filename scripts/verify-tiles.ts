/**
 * Checks the Deep Zoom pyramids against whatever database is configured.
 *
 *   npm run check:tiles
 *   ASTROBLOG_DATA_DIR=... npm run check:tiles
 *
 * The URL contract is the point of this script. The viewer never fetches the
 * `.dzi` descriptor — it computes every tile URL arithmetically from numbers in
 * the database — so a wrong `maxLevel`, tile size or extension produces URLs
 * that look entirely plausible and 404. Worse, the failure hides: the base
 * image is still painted underneath, so a fully broken pyramid renders as a
 * viewer that is merely a bit soft. Nothing about that is visible by eye, which
 * is exactly why it is asserted here.
 */
import fs from "node:fs";
import path from "node:path";

import { db } from "../src/server/db/client";
import { frameImages, frameTiles, frames } from "../src/server/db/schema";
import { TILE_ACTIVATION, levelSize } from "../src/server/media/derivatives";
import { MEDIA_ROOT } from "../src/server/paths";

let failures = 0;

const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
};

/** The exact arithmetic ViewerTiles uses to build a tile URL. */
function clientTileUrl(
  tiles: typeof frameTiles.$inferSelect,
  level: number,
  col: number,
  row: number,
) {
  return `${tiles.path}/${level}/${col}_${row}.${tiles.extension}`;
}

async function main() {
  const frameRows = db.select().from(frames).all();
  const tileRows = db.select().from(frameTiles).all();
  const imageRows = db.select().from(frameImages).all();

  console.log(`\n== pyramids ==\n`);

  for (const frame of frameRows) {
    const tiles = tileRows.find((t) => t.frameId === frame.id);
    const base = imageRows.find(
      (i) => i.frameId === frame.id && i.variant === "viewer" && i.format === "jpeg",
    );
    const master = imageRows.find((i) => i.frameId === frame.id && i.variant === "master");

    if (!base || !master) {
      console.log(`  SKIP  ${frame.slug} (no base or master)`);
      continue;
    }

    // A pyramid should exist exactly when the master meaningfully outresolves
    // the base — the same test the pipeline applies.
    const shouldHaveTiles = master.width > base.width * TILE_ACTIVATION;
    check(
      `${frame.slug}: pyramid ${shouldHaveTiles ? "present" : "absent"} as expected`,
      shouldHaveTiles === Boolean(tiles),
      `master ${master.width}px, base ${base.width}px`,
    );
    if (!tiles) continue;

    // The deepest level must be the master's own resolution, or 1:1 is a lie.
    check(
      `${frame.slug}: deepest level is full resolution`,
      tiles.width === master.width && tiles.height === master.height,
      `tiles ${tiles.width}x${tiles.height}, master ${master.width}x${master.height}`,
    );

    // Everything the base image already covers must have been pruned, and
    // everything kept must be worth keeping.
    const floor = levelSize(tiles.width, tiles.height, tiles.maxLevel, tiles.minLevel);
    check(
      `${frame.slug}: prune floor is above the base`,
      floor.width > base.width * TILE_ACTIVATION,
      `level ${tiles.minLevel} is ${floor.width}px, base ${base.width}px`,
    );

    const belowFloor = tiles.minLevel - 1;
    if (belowFloor >= 0) {
      const strayDir = path.join(MEDIA_ROOT, tiles.path, String(belowFloor));
      check(
        `${frame.slug}: level ${belowFloor} was pruned from disk`,
        !fs.existsSync(strayDir),
        strayDir,
      );
    }

    // Counts derived the way the client derives them. A wrong maxLevel yields
    // URLs that resolve in the middle of the image and 404 only at the edges.
    let expected = 0;
    for (let level = tiles.minLevel; level <= tiles.maxLevel; level++) {
      const { width, height } = levelSize(tiles.width, tiles.height, tiles.maxLevel, level);
      expected += Math.ceil(width / tiles.tileSize) * Math.ceil(height / tiles.tileSize);
    }
    check(
      `${frame.slug}: tile count matches the ceil arithmetic`,
      expected === tiles.tileCount,
      `computed ${expected}, stored ${tiles.tileCount}`,
    );

    // Every URL the client would build for the deepest level must resolve —
    // including the partial tiles in the last column and row.
    const deepest = levelSize(tiles.width, tiles.height, tiles.maxLevel, tiles.maxLevel);
    const cols = Math.ceil(deepest.width / tiles.tileSize);
    const rows = Math.ceil(deepest.height / tiles.tileSize);
    const missing: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rel = clientTileUrl(tiles, tiles.maxLevel, c, r);
        if (!fs.existsSync(path.join(MEDIA_ROOT, rel))) missing.push(rel);
      }
    }
    check(
      `${frame.slug}: all ${cols * rows} deepest-level URLs resolve`,
      missing.length === 0,
      missing.length ? `missing ${missing.length}, first: ${missing[0]}` : "",
    );

    // The descriptor is never read, so it must never be shipped either.
    const dzi = path.join(MEDIA_ROOT, path.dirname(tiles.path), "tiles.dzi");
    check(`${frame.slug}: no .dzi left to upload`, !fs.existsSync(dzi), dzi);
  }

  console.log(
    `\n${failures === 0 ? "TILE CHECKS PASSED" : `TILE CHECKS FAILED (${failures})`}\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
