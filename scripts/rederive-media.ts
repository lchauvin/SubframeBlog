/**
 * Regenerates every frame's derivatives from its stored master.
 *
 *   npm run media:rederive              # every frame
 *   npm run media:rederive -- ngc-6888  # one frame
 *
 * `processMaster()` is otherwise only reachable from an upload
 * (`app/admin/upload/route.node.ts`) or a full reseed, so a change to VARIANTS
 * had no way of reaching frames already in the database. This is that way.
 *
 * Non-destructive as far as content goes: it rewrites `frame_images` rows and
 * the derivative files, and never touches the master or the frame record.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { db } from "../src/server/db/client";
import { frameImages, frames } from "../src/server/db/schema";
import { processMaster } from "../src/server/media/derivatives";
import { MEDIA_ROOT } from "../src/server/paths";

async function main() {
  const only = process.argv[2]?.trim();

  const rows = await db
    .select({ id: frames.id, slug: frames.slug })
    .from(frames)
    .orderBy(frames.id)
    .all();

  const targets = only ? rows.filter((r) => r.slug === only) : rows;

  if (only && targets.length === 0) {
    console.error(`No frame with slug "${only}". Known slugs:`);
    for (const r of rows) console.error(`  ${r.slug}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Re-deriving ${targets.length} frame${targets.length === 1 ? "" : "s"}…\n`);

  let done = 0;
  let skipped = 0;

  for (const frame of targets) {
    const masterRow = db
      .select()
      .from(frameImages)
      .where(and(eq(frameImages.frameId, frame.id), eq(frameImages.variant, "master")))
      .get();

    if (!masterRow) {
      console.warn(`  ! ${frame.slug}: no master row — skipped`);
      skipped++;
      continue;
    }

    const masterPath = path.join(MEDIA_ROOT, masterRow.path);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(masterPath);
    } catch {
      // One missing file must not abort the run — the rest are still fixable.
      console.warn(`  ! ${frame.slug}: master missing at ${masterPath} — skipped`);
      skipped++;
      continue;
    }

    const started = Date.now();
    const result = await processMaster({ frameId: frame.id, slug: frame.slug, buffer });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const viewer = result.generated.find((g) => g.variant === "viewer" && g.format === "jpeg");
    console.log(
      `  ${frame.slug}: ${result.generated.length} derivatives in ${seconds}s` +
        (viewer ? `  (viewer ${viewer.width}×${viewer.height})` : ""),
    );
    done++;
  }

  console.log(`\nDone. ${done} re-derived${skipped ? `, ${skipped} skipped` : ""}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
