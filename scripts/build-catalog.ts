/**
 * Builds the bundled catalogues: deep-sky objects used to annotate solved
 * frames, and bright stars used as the sky atlas backdrop.
 *
 *   npm run build:catalog
 *
 * Writes catalog/deep-sky.json and catalog/stars.json — committed to the repo,
 * read from disk at render time (not imported, so neither enters a bundle).
 *
 * Sources, all freely redistributable with acknowledgement:
 *   OpenNGC   NGC + IC + Messier   CC-BY-SA-4.0   github.com/mattiaverga/OpenNGC
 *   VII/20    Sharpless (Sh2)      Sharpless 1959, via VizieR (CDS)
 *   VII/9     Lynds Bright Nebulae Lynds 1965,     via VizieR (CDS)
 *   VII/7A    Lynds Dark Nebulae   Lynds 1962,     via VizieR (CDS)
 *   V/50      Yale Bright Star Cat Hoffleit 1991,  via VizieR (CDS)
 *   d3-celestial  constellation lines  BSD-3-Clause, (c) 2015 Olaf Frohn
 *                 github.com/ofrohn/d3-celestial
 */
import fs from "node:fs/promises";
import path from "node:path";

type Entry = [name: string, ra: number, dec: number, diamArcmin: number, type: string];

const OUT = path.join(process.cwd(), "catalog", "deep-sky.json");
const STARS_OUT = path.join(process.cwd(), "catalog", "stars.json");
const LINES_OUT = path.join(process.cwd(), "catalog", "constellations.json");

/**
 * Naked-eye limit. Panels pick a stricter cut from their own span, so this only
 * has to be deep enough for the tightest panel the atlas will ever draw.
 */
const STAR_MAG_LIMIT = 6.5;
/** Below this, a star is a recognisable landmark worth naming. */
const STAR_LABEL_MAG = 2.5;

/** OpenNGC types that are not sky objects worth marking. */
const SKIP_TYPES = new Set(["Dup", "NonEx", "Star", "**", "*"]);

const round = (n: number, dp: number) => Number(n.toFixed(dp));

async function get(url: string, label: string): Promise<string> {
  process.stdout.write(`  ${label} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
  return text;
}

/** "00:08:27.05" -> degrees; "+27:43:03.6" -> degrees. */
function sexagesimal(value: string, isHours: boolean): number | null {
  const m = /^\s*([+-]?)(\d+):(\d+):([\d.]+)\s*$/.exec(value);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const deg = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return sign * deg * (isHours ? 15 : 1);
}

/** Turns OpenNGC's zero-padded names into the form the design uses. */
function tidyOpenNgcName(raw: string): string | null {
  const m = /^([A-Za-z]+)(\d+)([A-Za-z]?)$/.exec(raw.trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const label = prefix === "NGC" ? "NGC" : prefix === "IC" ? "IC" : null;
  if (!label) return null; // Mel/Cr/etc. live in OpenNGC too; skip them here
  return `${label} ${Number(m[2])}${m[3] ? m[3].toUpperCase() : ""}`;
}

async function openNgc(): Promise<Entry[]> {
  const csv = await get(
    "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
    "OpenNGC (NGC + IC + Messier)",
  );

  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(";");
  const col = (n: string) => header.indexOf(n);
  const [iName, iType, iRa, iDec, iMaj, iM] = [
    col("Name"), col("Type"), col("RA"), col("Dec"), col("MajAx"), col("M"),
  ];

  const out: Entry[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split(";");
    const type = (f[iType] ?? "").trim();
    if (SKIP_TYPES.has(type)) continue;

    const ra = sexagesimal(f[iRa] ?? "", true);
    const dec = sexagesimal(f[iDec] ?? "", false);
    if (ra === null || dec === null) continue;

    const name = tidyOpenNgcName(f[iName] ?? "");
    if (!name) continue;

    // Messier objects are better known by their M number.
    const messier = (f[iM] ?? "").trim();
    const label = messier ? `M ${Number(messier)}` : name;

    const maj = Number(f[iMaj]);
    out.push([label, round(ra, 5), round(dec, 5), Number.isFinite(maj) ? round(maj, 2) : 0, type]);
  }
  return out;
}

async function vizier(
  source: string,
  columns: string,
  label: string,
  build: (fields: string[]) => Entry | null,
): Promise<Entry[]> {
  const url =
    `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=${encodeURIComponent(source)}` +
    `&-out.max=unlimited&-out=_RAJ2000,_DEJ2000,${columns}`;
  const tsv = await get(url, label);

  const out: Entry[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t").map((s) => s.trim());
    // Data rows start with a numeric RA; headers and rulers do not.
    if (!/^\d/.test(fields[0] ?? "")) continue;
    const entry = build(fields);
    if (entry) out.push(entry);
  }
  return out;
}

const GREEK: Record<string, string> = {
  alp: "α", bet: "β", gam: "γ", del: "δ", eps: "ε", zet: "ζ",
  eta: "η", the: "θ", iot: "ι", kap: "κ", lam: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omi: "ο", pi: "π", rho: "ρ", sig: "σ",
  tau: "τ", ups: "υ", phi: "φ", chi: "χ", psi: "ψ", ome: "ω",
};
const SUPERSCRIPT = ["", "¹", "²", "³"];

/**
 * "21Alp And" -> "α And", "57Gam1And" -> "γ¹ And".
 *
 * The Bayer designation is preferred over a proper name: it is what the BSC
 * actually carries, and Greek-plus-abbreviation suits a technical chart better
 * than "Deneb" would. Stars with only a Flamsteed number get no label.
 */
function bayerLabel(raw: string): string | null {
  const m = /^\s*\d*\s*([A-Za-z]{2,3})(\d?)\s*([A-Za-z]{3})\s*$/.exec(raw ?? "");
  if (!m) return null;
  const greek = GREEK[m[1].toLowerCase()];
  if (!greek) return null;
  const index = m[2] ? SUPERSCRIPT[Number(m[2])] ?? "" : "";
  return `${greek}${index} ${m[3][0].toUpperCase()}${m[3].slice(1).toLowerCase()}`;
}

type Star = [ra: number, dec: number, vmag: number, label?: string];

/**
 * Bright stars for the sky atlas backdrop. Positions only — this catalogue is
 * never used to identify anything, just to make a region recognisable.
 */
async function stars(): Promise<Star[]> {
  const tsv = await get(
    "https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=V/50&-out.max=unlimited" +
      `&-out=_RAJ2000,_DEJ2000,Vmag,Name&Vmag=%3C${STAR_MAG_LIMIT}`,
    "Yale Bright Star Catalogue",
  );

  const out: Star[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t").map((s) => s.trim());
    if (!/^\d/.test(f[0] ?? "")) continue;

    const [ra, dec, vmag] = [Number(f[0]), Number(f[1]), Number(f[2])];
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(vmag)) continue;

    // Three decimals is ~4 arcsec: far finer than a star drawn 2px wide needs,
    // and it keeps the file a third smaller than full precision would.
    const star: Star = [round(ra, 3), round(dec, 3), round(vmag, 2)];
    if (vmag <= STAR_LABEL_MAG) {
      const label = bayerLabel(f[3] ?? "");
      if (label) star.push(label);
    }
    out.push(star);
  }

  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/** IAU abbreviation -> the full name a reader recognises. */
const CONSTELLATION_NAMES: Record<string, string> = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aql: "Aquila", Aqr: "Aquarius",
  Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum",
  Cam: "Camelopardalis", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia",
  Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon",
  Cir: "Circinus", CMa: "Canis Major", CMi: "Canis Minor", Cnc: "Cancer",
  Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis",
  CrB: "Corona Borealis", Crt: "Crater", Cru: "Crux", Crv: "Corvus",
  CVn: "Canes Venatici", Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado",
  Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax", Gem: "Gemini",
  Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus",
  Ind: "Indus", Lac: "Lacerta", Leo: "Leo", Lep: "Lepus", Lib: "Libra",
  LMi: "Leo Minor", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa",
  Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma",
  Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo", Peg: "Pegasus",
  Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", PsA: "Piscis Austrinus",
  Psc: "Pisces", Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Scl: "Sculptor",
  Sco: "Scorpius", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans",
  Sge: "Sagitta", Sgr: "Sagittarius", Tau: "Taurus", Tel: "Telescopium",
  TrA: "Triangulum Australe", Tri: "Triangulum", Tuc: "Tucana",
  UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo",
  Vol: "Volans", Vul: "Vulpecula",
};

type Constellation = { id: string; name: string; lines: [number, number][][] };

/**
 * Constellation stick figures, as coordinate polylines.
 *
 * The source is GeoJSON, so right ascension arrives as a longitude in
 * [-180, 180] and has to be wrapped back into [0, 360) before it means
 * anything to the rest of this codebase.
 */
async function constellations(): Promise<Constellation[]> {
  const raw = await get(
    "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json",
    "Constellation lines (d3-celestial)",
  );
  const geo = JSON.parse(raw) as {
    features: { id: string; geometry: { coordinates: [number, number][][] } }[];
  };

  return geo.features.map((feature) => ({
    id: feature.id,
    name: CONSTELLATION_NAMES[feature.id] ?? feature.id,
    lines: feature.geometry.coordinates.map((line) =>
      line.map(
        ([lon, dec]) => [round(((lon % 360) + 360) % 360, 4), round(dec, 4)] as [number, number],
      ),
    ),
  }));
}

async function main() {
  console.log("Downloading catalogues…");

  const ngc = await openNgc();

  const sh2 = await vizier("VII/20", "Sh2,Diam", "Sharpless (Sh2)", (f) => {
    const [ra, dec, id, diam] = [Number(f[0]), Number(f[1]), f[2], Number(f[3])];
    if (!Number.isFinite(ra) || !id) return null;
    return [`Sh2-${Number(id)}`, round(ra, 5), round(dec, 5), Number.isFinite(diam) ? diam : 0, "HII"];
  });

  const lbn = await vizier("VII/9", "Seq,Diam1", "Lynds Bright Nebulae (LBN)", (f) => {
    const [ra, dec, id, diam] = [Number(f[0]), Number(f[1]), f[2], Number(f[3])];
    if (!Number.isFinite(ra) || !id) return null;
    return [`LBN ${Number(id)}`, round(ra, 5), round(dec, 5), Number.isFinite(diam) ? diam : 0, "Neb"];
  });

  const ldn = await vizier("VII/7A", "LDN,Area", "Lynds Dark Nebulae (LDN)", (f) => {
    const [ra, dec, id, area] = [Number(f[0]), Number(f[1]), f[2], Number(f[3])];
    if (!Number.isFinite(ra) || !id) return null;
    // Area is in square degrees; treat it as a disc to get a diameter.
    const diam = Number.isFinite(area) ? round(2 * Math.sqrt(area / Math.PI) * 60, 2) : 0;
    return [`LDN ${Number(id)}`, round(ra, 5), round(dec, 5), diam, "DrkN"];
  });

  const all = [...ngc, ...sh2, ...lbn, ...ldn];

  // Same designation twice (OpenNGC lists a few aliases) — keep the first.
  const seen = new Set<string>();
  const objects = all.filter((e) => {
    const key = e[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  objects.sort((a, b) => a[1] - b[1]); // by RA, so cone searches stay cache-friendly

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    format: "[name, raDeg, decDeg, majorAxisArcmin, type]",
    sources: [
      "OpenNGC (CC-BY-SA-4.0) — github.com/mattiaverga/OpenNGC",
      "Sharpless 1959, VizieR VII/20 (CDS)",
      "Lynds 1965 Bright Nebulae, VizieR VII/9 (CDS)",
      "Lynds 1962 Dark Nebulae, VizieR VII/7A (CDS)",
    ],
    counts: { ngc: ngc.length, sh2: sh2.length, lbn: lbn.length, ldn: ldn.length },
    objects,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload));

  const bytes = (await fs.stat(OUT)).size;
  console.log(`\nNGC/IC/M ${ngc.length} · Sh2 ${sh2.length} · LBN ${lbn.length} · LDN ${ldn.length}`);
  console.log(`${objects.length} objects after de-duplication`);
  console.log(`Wrote ${OUT} (${(bytes / 1024).toFixed(0)} KB)`);

  const starList = await stars();
  await fs.writeFile(
    STARS_OUT,
    JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      format: "[raDeg, decDeg, vmag, bayerLabel?]",
      sources: ["Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren 1991), VizieR V/50 (CDS)"],
      magnitudeLimit: STAR_MAG_LIMIT,
      labelMagnitude: STAR_LABEL_MAG,
      count: starList.length,
      stars: starList,
    }),
  );

  const starBytes = (await fs.stat(STARS_OUT)).size;
  const labelled = starList.filter((s) => s.length > 3).length;
  console.log(
    `\n${starList.length} stars to mag ${STAR_MAG_LIMIT} (${labelled} labelled)` +
      `\nWrote ${STARS_OUT} (${(starBytes / 1024).toFixed(0)} KB)`,
  );

  const figures = await constellations();
  await fs.writeFile(
    LINES_OUT,
    JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      format: "{ id, name, lines: [[raDeg, decDeg], …][] }",
      sources: [
        "Constellation figures from d3-celestial (BSD-3-Clause), (c) 2015 Olaf Frohn — github.com/ofrohn/d3-celestial",
      ],
      count: figures.length,
      constellations: figures,
    }),
  );

  const lineBytes = (await fs.stat(LINES_OUT)).size;
  const polylines = figures.reduce((n, c) => n + c.lines.length, 0);
  console.log(
    `\n${figures.length} constellations · ${polylines} polylines` +
      `\nWrote ${LINES_OUT} (${(lineBytes / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
