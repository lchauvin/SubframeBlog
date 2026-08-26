import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { asc } from "drizzle-orm";

import { db } from "../db/client";
import { frameImages, frameTiles, frames } from "../db/schema";
import { MEDIA_ROOT } from "../paths";
import { TILE_ACTIVATION, TILE_SIZE, VARIANTS } from "./derivatives";

export type MediaStatus = {
  frameId: number;
  slug: string;
  catalogId: string;
  /** Present derivatives cannot be rebuilt without it. */
  hasMaster: boolean;
  masterWidth: number;
  masterHeight: number;
  /** Long edge of the viewer derivative currently on disk, 0 when absent. */
  viewerLongEdge: number;
  expectedViewerLongEdge: number;
  tileCount: number;
  expectsTiles: boolean;
  stale: boolean;
  /** Why it is stale, for the admin list. Empty when current. */
  reasons: string[];
};

const VIEWER = VARIANTS.find((v) => v.name === "viewer")!;

/**
 * What each frame's derivatives are, against what the current pipeline would
 * produce for them.
 *
 * `processMaster()` only ever runs on upload, so a change to `VARIANTS` reaches
 * nothing already in the database. Locally that is what `npm run media:rederive`
 * is for; in production the script needs `tsx`, a devDependency that may not be
 * installed, so the admin needs its own answer to "which frames are behind?".
 */
export async function listMediaStatus(): Promise<MediaStatus[]> {
  const frameRows = await db
    .select({ id: frames.id, slug: frames.slug, catalogId: frames.catalogId })
    .from(frames)
    .orderBy(asc(frames.id));

  const imageRows = await db.select().from(frameImages);
  const tileRows = await db.select().from(frameTiles);

  const out: MediaStatus[] = [];

  for (const frame of frameRows) {
    const master = imageRows.find((i) => i.frameId === frame.id && i.variant === "master");
    const viewer = imageRows.find(
      (i) => i.frameId === frame.id && i.variant === "viewer" && i.format === "jpeg",
    );
    const tiles = tileRows.find((t) => t.frameId === frame.id);

    const masterWidth = master?.width ?? 0;
    const masterHeight = master?.height ?? 0;
    const masterLongEdge = Math.max(masterWidth, masterHeight);

    // `fit: inside` with equal bounds caps the long edge, and
    // `withoutEnlargement` means a small master yields a smaller derivative.
    const expectedViewerLongEdge = Math.min(masterLongEdge, VIEWER.longEdge);
    const viewerLongEdge = viewer ? Math.max(viewer.width, viewer.height) : 0;

    // The row can outlive the files — a restored database against a media
    // directory that was not restored with it.
    let masterOnDisk = false;
    if (master) {
      try {
        await fs.access(path.join(MEDIA_ROOT, master.path));
        masterOnDisk = true;
      } catch {
        masterOnDisk = false;
      }
    }

    const expectsTiles = masterWidth > expectedViewerLongEdge * TILE_ACTIVATION;

    const reasons: string[] = [];
    if (!master) reasons.push("no master recorded");
    else if (!masterOnDisk) reasons.push("master file missing");
    if (!viewer) reasons.push("no viewer derivative");
    else if (viewerLongEdge !== expectedViewerLongEdge) {
      reasons.push(`viewer is ${viewerLongEdge}px, expected ${expectedViewerLongEdge}px`);
    }
    if (expectsTiles && !tiles) reasons.push("no tile pyramid");
    if (tiles && tiles.tileSize !== TILE_SIZE) {
      reasons.push(`tiles are ${tiles.tileSize}px, expected ${TILE_SIZE}px`);
    }
    if (!expectsTiles && tiles) reasons.push("tiles present but not needed");

    out.push({
      frameId: frame.id,
      slug: frame.slug,
      catalogId: frame.catalogId,
      hasMaster: masterOnDisk,
      masterWidth,
      masterHeight,
      viewerLongEdge,
      expectedViewerLongEdge,
      tileCount: tiles?.tileCount ?? 0,
      expectsTiles,
      // A frame whose master is gone cannot be fixed by re-deriving, so it is
      // reported but never offered as work.
      stale: masterOnDisk && reasons.length > 0,
      reasons,
    });
  }

  return out;
}
