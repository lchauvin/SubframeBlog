/**
 * Checks the plate-solve logic that cannot be exercised without an API key:
 * coordinate parsing, search-hint maths, and object selection/labelling.
 *
 * Run with: npm run check:astrometry
 */
import Database from "better-sqlite3";
import { parseRaDec, fieldRadiusDegrees } from "../src/lib/coordinates";
import { selectAnnotations, pickName } from "../src/server/astrometry/objects";
import {
  parseWcsHeader,
  pixelToSky,
  skyToPixel,
  angularSeparation,
} from "../src/server/astrometry/wcs";
import { catalogAvailable, markersForFrame } from "../src/server/astrometry/catalog";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown, tol = 0) => {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tol
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}\n        got ${JSON.stringify(actual)}${ok ? "" : `  want ${JSON.stringify(expected)}`}`);
};

console.log("\n== parseRaDec against the real seeded plate coordinates ==");
try {
  const db = new Database("data/astroblog.db", { readonly: true, fileMustExist: true });
  const rows = db
    .prepare("select slug, plate_coordinates, arcsec_per_px from frames order by slug")
    .all() as { slug: string; plate_coordinates: string; arcsec_per_px: number }[];

  for (const r of rows) {
    const p = parseRaDec(r.plate_coordinates);
    console.log(
      `  ${r.slug.padEnd(10)} "${r.plate_coordinates}"\n        -> ${
        p ? `RA ${p.ra.toFixed(4)}°  Dec ${p.dec.toFixed(4)}°` : "UNPARSED"
      }`,
    );
    if (!p) failures++;
  }
  db.close();
} catch {
  console.log("  (no database yet — skipping, the fixed checks below still run)");
}

console.log("\n== known-value checks ==");
// IC 1848 is at roughly RA 02h51m = 42.75°, Dec +60°26' = +60.433°
check("IC 1848 RA", parseRaDec("RA 02h 51m · Dec +60° 26′")?.ra, 42.75, 0.01);
check("IC 1848 Dec", parseRaDec("RA 02h 51m · Dec +60° 26′")?.dec, 60.4333, 0.01);
// Southern declination must keep its sign through the arcmin term.
check("negative dec", parseRaDec("RA 05h 35m · Dec -05° 27′")?.dec, -5.45, 0.01);
check("unparseable returns null", parseRaDec("somewhere in Cygnus"), null);
check("empty returns null", parseRaDec(""), null);

console.log("\n== field radius (5983x3499 at 2.39\"/px) ==");
// width 3.972°, height 2.323° -> half-diagonal 2.299°
const radius = fieldRadiusDegrees(5983, 3499, 2.39);
check("half-diagonal deg", radius, 2.299, 0.01);

console.log("\n== scale hint must describe the SUBMITTED image, not the master ==");
const submittedScale = (2.39 * 5983) / 2048;
check("2048px derivative arcsec/px", Number(submittedScale.toFixed(3)), 6.982, 0.001);

console.log("\n== scale bounds must survive an oversampled export ==");
// The stored arcsec/px is a property of the sensor+optics. A 5983px export off
// a 3856px sensor is 1.55x oversampled, so the image's true scale is ~0.64x the
// nominal. The submitted bounds must still contain it, or the solve fails.
const trueMasterScale = (3856 * 2.39) / 5983; // ~1.540
const trueSubmitted = (trueMasterScale * 5983) / 2048; // ~4.499
const lower = submittedScale / 4;
const upper = submittedScale * 2;
console.log(`  bounds ${lower.toFixed(2)}–${upper.toFixed(2)}"/px, truth ${trueSubmitted.toFixed(2)}"/px`);
check("true scale inside bounds", trueSubmitted > lower && trueSubmitted < upper, true);
// The old +/-20% window is what actually broke the first live solve.
check(
  "old +/-20% window would have excluded it",
  trueSubmitted > submittedScale * 0.8 && trueSubmitted < submittedScale * 1.2,
  false,
);

console.log("\n== pickName preference ==");
check("Messier wins", pickName(["NGC 1952", "M 1", "Sh2-244"]), "M 1");
check("NGC over IC", pickName(["IC 405", "NGC 1893"]), "NGC 1893");
check("Sharpless over LBN", pickName(["LBN 251", "Sh2-109"]), "Sh2-109");
check("spacing tidied", pickName(["NGC6888"]), "NGC 6888");
check("falls back to first", pickName(["Some Object"]), "Some Object");

console.log("\n== selectAnnotations on a realistic solver payload ==");
const submitted = { width: 2048, height: 1198 };
const raw = [
  { type: "ngc", names: ["NGC 6888", "Caldwell 27"], pixelx: 1024, pixely: 600, radius: 190 },
  { type: "ngc", names: ["Sh2-109"], pixelx: 1500, pixely: 400, radius: 90 },
  { type: "hd", names: ["HD 191765"], pixelx: 1000, pixely: 590, radius: 12 },
  { type: "tycho2", names: ["TYC 3149-1234-1"], pixelx: 300, pixely: 800, radius: 8 },
  { type: "bright", names: ["Sadr"], pixelx: 200, pixely: 200, radius: 10 },
  { type: "ngc", names: ["LBN 251"], pixelx: 800, pixely: 900, radius: 60 },
  // Duplicate designation for an object already listed.
  { type: "ic", names: ["NGC 6888"], pixelx: 1024, pixely: 600, radius: 185 },
  // Centre falls outside the frame - solver reports these, we should not.
  { type: "ngc", names: ["NGC 6871"], pixelx: 2600, pixely: 600, radius: 40 },
  { type: "ngc", names: ["NGC 9999"], pixelx: 500, pixely: -50, radius: 30 },
];

const { selected, consideredCount } = selectAnnotations(raw, submitted, 8);
console.log(`  considered (deep-sky): ${consideredCount}`);
for (const s of selected) {
  console.log(`    ${s.label.padEnd(12)} x ${String(s.xPct).padStart(6)}%  y ${String(s.yPct).padStart(6)}%  Ø ${s.radiusPx}`);
}

check("stars excluded", selected.some((s) => /HD |TYC |Sadr/.test(s.label)), false);
check("duplicates collapsed", selected.filter((s) => s.label === "NGC 6888").length, 1);
check("off-frame x excluded", selected.some((s) => s.label === "NGC 6871"), false);
check("off-frame y excluded", selected.some((s) => s.label === "NGC 9999"), false);
check("largest object first", selected[0]?.label, "NGC 6888");
check("count", selected.length, 3);
// 1024/2048 = 50%, 600/1198 = 50.08%
check("centre maps to 50%", selected[0]?.xPct, 50, 0.01);
// radius 190/2048 = 9.28% of width -> 148 design px, clamped to 120
check("oversized radius clamped", selected[0]?.radiusPx, 120);
// radius 90/2048 = 4.39% -> 70 design px, within range
check("mid radius scaled", selected.find((s) => s.label === "Sh2-109")?.radiusPx, 70, 1);

console.log("\n== WCS parsing and TAN projection ==");
// Real cards from the IC 1848 solve (job 16709849), inlined so this runs
// offline. astrometry.net independently reported that image's centre as
// RA 43.6415, Dec 60.3084 — nothing below uses that except as the answer key.
const card = (s: string) => s.padEnd(80, " ");
const header =
  card("SIMPLE  =                    T") +
  card("CTYPE1  = 'RA---TAN-SIP'") +
  card("CTYPE2  = 'DEC--TAN-SIP'") +
  card("CRVAL1  =        44.4702315232 / RA  of reference point") +
  card("CRVAL2  =        59.8714669714 / DEC of reference point") +
  card("CRPIX1  =        1382.66830444 / X reference pixel") +
  card("CRPIX2  =        234.196639061 / Y reference pixel") +
  card("CD1_1   =    0.00121750327895") +
  card("CD1_2   =    7.52776925781E-05") +
  card("CD2_1   =   -7.41796478718E-05") +
  card("CD2_2   =    0.00121692451576") +
  card("IMAGEW  =                 2048") +
  card("IMAGEH  =                 1146") +
  card("END");

const wcs = parseWcsHeader(header);
check("header parses", wcs !== null, true);

if (wcs) {
  check("CRVAL1 read", wcs.crval1, 44.4702315232, 1e-9);
  check("CD1_2 read (exponential notation)", wcs.cd12, 7.52776925781e-5, 1e-15);
  check("IMAGEW read", wcs.imageWidth, 2048);

  // FITS pixels are 1-based, so the centre of a W x H image is ((W+1)/2,(H+1)/2).
  const centre = pixelToSky(wcs, (2048 + 1) / 2, (1146 + 1) / 2);
  const sep = angularSeparation(centre.ra, centre.dec, 43.6415, 60.3084);
  console.log(`  computed centre RA ${centre.ra.toFixed(4)} Dec ${centre.dec.toFixed(4)} · ${(sep * 3600).toFixed(1)}" from reported`);
  check("centre matches the solver's own, within 2 arcsec", sep * 3600 < 2, true);

  let worst = 0;
  for (const [x, y] of [[1, 1], [512, 300], [1024.5, 573.5], [2048, 1146]]) {
    const sky = pixelToSky(wcs, x, y);
    const back = skyToPixel(wcs, sky.ra, sky.dec)!;
    worst = Math.max(worst, Math.hypot(back.x - x, back.y - y));
  }
  check("pixel -> sky -> pixel round trip closes", worst < 1e-6, true);

  const scale = Math.sqrt(Math.abs(wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21)) * 3600;
  check("scale from CD matrix", Number(scale.toFixed(3)), 4.39, 0.005);

  // Anything on the far hemisphere has no gnomonic projection.
  check("antipode is rejected", skyToPixel(wcs, (44.47 + 180) % 360, -59.87), null);

  console.log("\n== bundled catalogue: what lands in this real IC 1848 field ==");
  if (!catalogAvailable()) {
    console.log("  (no catalogue built — run npm run build:catalog)");
  } else {
    const image = { width: 2048, height: 1146 };
    const { markers, consideredCount } = markersForFrame(wcs, image, {
      limit: 8,
      targetName: "IC 1848",
    });
    for (const m of markers) {
      console.log(`  ${m.label.padEnd(11)} x ${m.xPct.toFixed(1)}%  y ${m.yPct.toFixed(1)}%  Ø ${m.radiusPx}`);
    }

    const labels = markers.map((m) => m.label);
    check("finds objects in field", consideredCount > 0, true);
    check("the frame's own target is present", labels.includes("IC 1848"), true);
    check(
      "target beats its Sharpless alias in the same cluster",
      !labels.includes("Sh2-199"),
      true,
    );
    check(
      "catalogues astrometry.net lacks are represented",
      labels.some((l) => /^(Sh2-|LBN |LDN )/.test(l)),
      true,
    );
    // astrometry.net independently annotated IC 1871 at 63.03% / 77.36%.
    const ic1871 = markers.find((m) => m.label === "IC 1871");
    check(
      "IC 1871 agrees with astrometry.net's own placement within 1%",
      Boolean(ic1871) && Math.abs(ic1871!.xPct - 63.03) < 1 && Math.abs(ic1871!.yPct - 77.36) < 1,
      true,
    );
    check("no marker exceeds the size cap", markers.every((m) => m.radiusPx <= 64), true);
    check("markers are within the frame", markers.every((m) => m.xPct > 0 && m.xPct < 100), true);
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
