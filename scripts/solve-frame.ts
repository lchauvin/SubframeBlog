/**
 * Runs a plate solve for one frame from the command line.
 *
 *   npm run solve -- wr-134
 *   npm run solve -- --all          # every frame that has an image
 *
 * Useful for backfilling frames whose masters were uploaded before the
 * astrometry key was configured, without re-uploading them.
 *
 * NOTE: this uploads a 2048px derivative of the frame to nova.astrometry.net.
 */
import { eq } from "drizzle-orm";

import { db } from "../src/server/db/client";
import { annotations, frames } from "../src/server/db/schema";
import { isConfigured } from "../src/server/astrometry/client";
import { getPlateSolve, reannotateFrame, solveFrame } from "../src/server/astrometry/solve";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const all = process.argv.includes("--all");
/** Regenerate markers from an existing solution: no upload, no API key. */
const reannotate = process.argv.includes("--reannotate");

async function run() {
  if (!reannotate && !isConfigured()) {
    console.error("ASTROMETRY_API_KEY is not set. Add it to .env or .env.local.");
    process.exit(1);
  }

  const targets = all
    ? await db.select({ id: frames.id, slug: frames.slug }).from(frames)
    : await Promise.all(
        args.map(async (slug) =>
          db.select({ id: frames.id, slug: frames.slug }).from(frames).where(eq(frames.slug, slug)).get(),
        ),
      ).then((rows) => rows.filter((r): r is { id: number; slug: string } => Boolean(r)));

  if (targets.length === 0) {
    console.error(
      args.length > 0 ? `No frame with slug "${args.join('", "')}".` : "Usage: npm run solve -- <slug>",
    );
    process.exit(1);
  }

  for (const target of targets) {
    console.log(`\n=== ${target.slug} ===`);
    const started = Date.now();

    if (reannotate) {
      console.log(`  ${await reannotateFrame(target.id)}`);
      for (const a of (
        await db.select().from(annotations).where(eq(annotations.frameId, target.id))
      ).filter((r) => r.source === "auto")) {
        console.log(`     + ${a.label.padEnd(14)} x ${a.xPct.toFixed(1)}%  y ${a.yPct.toFixed(1)}%  Ø ${a.radiusPx}`);
      }
      continue;
    }

    // Report progress while the solve runs; it polls the public queue.
    const ticker = setInterval(async () => {
      const s = await getPlateSolve(target.id);
      if (s) console.log(`  [${((Date.now() - started) / 1000).toFixed(0)}s] ${s.status}: ${s.message}`);
    }, 5000);

    await solveFrame(target.id);
    clearInterval(ticker);

    const solve = await getPlateSolve(target.id);
    console.log(`  -> ${solve?.status}: ${solve?.message}`);
    if (solve?.status === "solved") {
      console.log(
        `     centre ${solve.centerRa?.toFixed(4)}°, ${solve.centerDec?.toFixed(4)}°` +
          ` · ${solve.pixScale?.toFixed(3)}"/px · rotation ${solve.orientation?.toFixed(1)}°`,
      );
      const rows = await db
        .select()
        .from(annotations)
        .where(eq(annotations.frameId, target.id));
      for (const a of rows.filter((r) => r.source === "auto")) {
        console.log(`     + ${a.label.padEnd(14)} x ${a.xPct.toFixed(1)}%  y ${a.yPct.toFixed(1)}%  Ø ${a.radiusPx}`);
      }
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
