/**
 * Loads the five design frames, the gear list, the About stats and the site
 * settings, generating image derivatives from design/img/*.jpg.
 *
 * Destructive: it clears the content tables first (admin users and sessions are
 * left alone). Run with: npm run seed
 */
import fs from "node:fs";
import path from "node:path";

import { db } from "../src/server/db/client";
import {
  annotations,
  frameFilters,
  frameGear,
  frameImages,
  frames,
  gearItems,
  nights,
  siteSettings,
  siteStats,
} from "../src/server/db/schema";
import { processMaster } from "../src/server/media/derivatives";
import { DEFAULT_GEAR, DEFAULT_SITE_SETTINGS, DEFAULT_STATS } from "../src/lib/defaults";
import { SEED_FRAMES } from "./seed-data";

const IMAGE_DIR = path.join(process.cwd(), "design", "img");

async function main() {
  console.log("Clearing content tables…");
  await db.delete(annotations);
  await db.delete(nights);
  await db.delete(frameFilters);
  await db.delete(frameGear);
  await db.delete(frameImages);
  await db.delete(frames);
  await db.delete(gearItems);
  await db.delete(siteStats);
  await db.delete(siteSettings);

  await db.insert(siteSettings).values({
    id: 1,
    ...DEFAULT_SITE_SETTINGS,
    logPaginationLabel: "Load 2021–2024",
    aboutHeroSlug: "wr-134",
    aboutHeroCaption: "WR 134 · 24h 10m · HOO",
    updatedAt: new Date(),
  });

  await db
    .insert(gearItems)
    .values(DEFAULT_GEAR.map((g, i) => ({ ...g, position: i })));

  await db.insert(siteStats).values(DEFAULT_STATS.map((s, i) => ({ ...s, position: i })));

  for (const [index, seed] of SEED_FRAMES.entries()) {
    const inserted = await db
      .insert(frames)
      .values({
        slug: seed.slug,
        catalogId: seed.catalogId,
        commonName: seed.commonName,
        frameNumber: seed.frameNumber,
        revision: seed.revision,
        capturedOn: seed.capturedOn,
        palette: seed.palette,
        bandwidth: "3nm",
        totalIntegrationMinutes: seed.totalIntegrationMinutes,
        metaLine: seed.metaLine,
        blurb: seed.blurb,
        bodyMarkdown: seed.prose.join("\n\n"),
        note: seed.note,
        ...seed.plate,
        opticsLabel: "250mm f/4.9",
        sensorLabel: "2.9µm",
        arcsecPerPx: 2.39,
        published: true,
        sortIndex: index,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: frames.id });

    const frameId = inserted[0].id;

    await db
      .insert(frameFilters)
      .values(seed.filters.map((f, i) => ({ ...f, frameId, position: i })));

    await db.insert(nights).values(seed.nights.map((n, i) => ({ ...n, frameId, position: i })));

    await db
      .insert(annotations)
      .values(seed.annotations.map((a, i) => ({ ...a, frameId, position: i })));

    await db
      .insert(frameGear)
      .values(DEFAULT_GEAR.map((g, i) => ({ ...g, frameId, position: i })));

    const source = path.join(IMAGE_DIR, seed.sourceImage);
    if (!fs.existsSync(source)) {
      console.warn(`  ! ${seed.slug}: ${seed.sourceImage} not found, skipping derivatives`);
      continue;
    }

    process.stdout.write(`  ${seed.slug}: deriving from ${seed.sourceImage}… `);
    const started = Date.now();
    const result = await processMaster({
      frameId,
      slug: seed.slug,
      buffer: await fs.promises.readFile(source),
    });
    console.log(
      `${result.master.width}×${result.master.height}, ` +
        `${result.generated.length} derivatives in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  console.log(`\nSeeded ${SEED_FRAMES.length} frames.`);
  console.log("All figures are placeholders — see the header of scripts/seed-data.ts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
