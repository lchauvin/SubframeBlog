/**
 * Checks the sky atlas geometry against whatever database is configured.
 *
 *   npm run check:atlas
 *   ASTROBLOG_DATA_DIR=... npm run check:atlas
 *
 * The orientation assertions are the point of this script. A mirrored sky
 * renders perfectly plausibly — every footprint lands in the right place
 * relative to the graticule — and is only obvious to someone who knows the
 * field, so the east-left / north-up convention is asserted explicitly.
 */
import { buildAtlas, type AtlasPanel } from "../src/server/atlas/build";
import { centroidOf } from "../src/server/atlas/project";

let failures = 0;

const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
};

/** Centre of a drawn footprint, in panel pixels. */
function footprintCentre(panel: AtlasPanel, slug: string): { x: number; y: number } | null {
  const fp = panel.footprints.find((f) => f.frames.some((fr) => fr.slug === slug));
  if (!fp) return null;
  const pts = fp.points.split(" ").map((p) => p.split(",").map(Number));
  return {
    x: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    y: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
}

function panelWith(panels: AtlasPanel[], slug: string): AtlasPanel | undefined {
  return panels.find(
    (p) =>
      p.footprints.some((f) => f.frames.some((fr) => fr.slug === slug)) ||
      p.pins.some((pin) => pin.frames.some((fr) => fr.slug === slug)),
  );
}

async function main() {
  const atlas = await buildAtlas();

  console.log("\n== panels ==");
  for (const panel of atlas.panels) {
    console.log(
      `  ${panel.title.padEnd(18)} ${String(panel.frameCount).padStart(2)} frames · ` +
        `${panel.footprints.length} footprints · ${panel.pins.length} pins · ` +
        `${panel.context.length} context · ${panel.graticule.ra.length}+${panel.graticule.dec.length} grid · ` +
        `${panel.width}x${Math.round(panel.height)} · ${panel.spanLabel} @ ${panel.centreLabel}`,
    );
  }
  if (atlas.unplaced.length > 0) {
    console.log(`  unplaced: ${atlas.unplaced.map((f) => f.slug).join(", ")}`);
  }

  console.log("\n== coverage ==");
  const drawnSlugs = atlas.panels.flatMap((p) => [
    ...p.footprints.flatMap((f) => f.frames.map((fr) => fr.slug)),
    ...p.pins.flatMap((pin) => pin.frames.map((fr) => fr.slug)),
  ]);
  const allSlugs = [...drawnSlugs, ...atlas.unplaced.map((f) => f.slug)];
  const unique = new Set(allSlugs);

  check(
    "every published frame is reachable exactly once",
    unique.size === atlas.frameCount && allSlugs.length === atlas.frameCount,
    `${allSlugs.length} references, ${unique.size} unique, ${atlas.frameCount} published`,
  );
  check("no frame left unplaced", atlas.unplaced.length === 0, `unplaced ${atlas.unplaced.length}`);

  console.log("\n== orientation (north-up, east-left) ==");
  // A mirrored chart is the failure mode these two catch.
  const cygnus = panelWith(atlas.panels, "north-america-nebula");
  if (cygnus) {
    const ngc7000 = footprintCentre(cygnus, "north-america-nebula"); // RA 314.79
    const ic5070 = footprintCentre(cygnus, "ic-5070"); // RA 313.87 — lower RA, so further right
    if (ngc7000 && ic5070) {
      check(
        "NGC 7000 renders left of IC 5070 (higher RA is further east)",
        ngc7000.x < ic5070.x,
        `NGC 7000 x=${ngc7000.x.toFixed(1)}, IC 5070 x=${ic5070.x.toFixed(1)}`,
      );
    } else {
      check("Cygnus footprints present", false, "NGC 7000 or IC 5070 missing");
    }
  } else {
    console.log("  (no Cygnus panel in this database — skipping)");
  }

  const cas = panelWith(atlas.panels, "ic-1805");
  if (cas) {
    const ic1805 = footprintCentre(cas, "ic-1805"); // Dec +61.5
    const ngc281 = footprintCentre(cas, "ngc-281"); // Dec +56.7 — lower, so further down
    if (ic1805 && ngc281) {
      check(
        "IC 1805 renders above NGC 281 (higher Dec is further north)",
        ic1805.y < ngc281.y,
        `IC 1805 y=${ic1805.y.toFixed(1)}, NGC 281 y=${ngc281.y.toFixed(1)}`,
      );
    } else {
      check("Cassiopeia footprints present", false, "IC 1805 or NGC 281 missing");
    }
  } else {
    console.log("  (no Cassiopeia panel in this database — skipping)");
  }

  console.log("\n== stacked revisions ==");
  const stacked = atlas.panels
    .flatMap((p) => [...p.footprints, ...p.pins])
    .filter((d) => d.frames.length > 1);
  for (const group of stacked) {
    const drawn = group.frames[0];
    console.log(
      `  ${group.label.padEnd(10)} draws ${drawn.slug} (${drawn.capturedOn}) · ` +
        `links ${group.frames.map((f) => f.slug).join(", ")}`,
    );
    check(
      `${group.label}: newest revision is the one drawn`,
      group.frames.every((f) => f.capturedOn <= drawn.capturedOn),
      `drawn ${drawn.capturedOn}, others ${group.frames.slice(1).map((f) => f.capturedOn).join(", ")}`,
    );
  }

  console.log("\n== wrap-safe centroid ==");
  // The Cassiopeia group really does straddle RA 0h; a naive mean lands in Leo.
  const wrapped = centroidOf([
    { ra: 349.07, dec: 60.54 },
    { ra: 14.85, dec: 60.96 },
    { ra: 43.63, dec: 60.31 },
  ]);
  check(
    "centroid of RA 349/15/44 stays in the Cassiopeia arc",
    wrapped.ra > 340 || wrapped.ra < 40,
    `got RA ${wrapped.ra.toFixed(2)}° Dec ${wrapped.dec.toFixed(2)}°`,
  );

  console.log("\n== panel sanity ==");
  for (const panel of atlas.panels) {
    const drawables = [...panel.footprints, ...panel.pins];
    // Strict: a footprint outside the viewBox is invisible, and the panel-sizing
    // maths is exactly where that happens silently.
    const outside = drawables.filter((d) => {
      const pts =
        "points" in d
          ? d.points.split(" ").map((p) => p.split(",").map(Number))
          : [
              [d.x, d.y],
              [d.x + d.size, d.y + d.size],
            ];
      return pts.some(([x, y]) => x < 0 || x > panel.width || y < 0 || y > panel.height);
    });
    check(
      `${panel.title}: every drawable lands inside the viewBox`,
      outside.length === 0,
      outside.length ? `outside: ${outside.map((d) => d.label).join(", ")}` : "",
    );
    check(`${panel.title}: graticule drawn`, panel.graticule.ra.length + panel.graticule.dec.length > 0);
  }

  console.log(
    `\n${failures === 0 ? "All atlas checks passed." : `${failures} atlas check(s) FAILED.`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
