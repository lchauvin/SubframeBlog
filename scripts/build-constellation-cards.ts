/**
 * Renders the constellation cards from a terminal.
 *
 *   npm run cards:constellation
 *   npm run cards:constellation -- --slug sh2-114
 *   npm run cards:constellation -- --out some/other/dir
 *
 * The drawing itself lives in `src/server/cards/constellation.ts`, shared with
 * the admin's own button so the two cannot drift apart. This file is only the
 * argument parsing and the printed report.
 *
 * Output goes to the runtime data directory by default, next to the media,
 * because that is where the admin writes and two copies in two places would be
 * worse than one in an unexpected one.
 */
import { buildConstellationCards, CARD_HEIGHT, CARD_WIDTH } from "../src/server/cards/constellation";

/** RA in degrees to the "21h 22m" form the spec plate uses. */
function raHms(raDeg: number): string {
  const hours = (((raDeg % 360) + 360) % 360) / 15;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `${(h + 1) % 24}h 00m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Dec in degrees to degrees and arcminutes. */
function decDms(decDeg: number): string {
  const sign = decDeg < 0 ? "−" : "+";
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.round((abs - d) * 60);
  const deg = m === 60 ? d + 1 : d;
  const min = m === 60 ? 0 : m;
  return `${sign}${deg}° ${String(min).padStart(2, "0")}′`;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = argValue("--slug");
  const run = await buildConstellationCards({ outDir: argValue("--out"), slug });

  if (run.results.length === 0) {
    console.log(slug ? `No published frame with slug "${slug}".` : "No published frames.");
    return;
  }

  console.log(`\n== constellation cards ==\n  ${CARD_WIDTH}x${CARD_HEIGHT} -> ${run.outDir}\n`);

  for (const r of run.results) {
    if (!r.ok) {
      console.log(`  SKIP  ${r.slug} — ${r.message}`);
      continue;
    }
    const via = r.matchedByName ? "plate name" : "nearest figure";
    console.log(
      `  ${r.slug.padEnd(12)} ${(r.constellation ?? "").padEnd(12)} ` +
        `RA ${raHms(r.ra ?? 0).padStart(8)}  Dec ${decDms(r.dec ?? 0).padStart(9)}  ` +
        `via ${via}, position from ${r.positionSource}`,
    );
  }

  const failed = run.results.length - run.written;
  console.log(
    `\n  ${run.written} card${run.written === 1 ? "" : "s"} written` +
      (failed > 0 ? `, ${failed} skipped` : "") +
      ".\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
