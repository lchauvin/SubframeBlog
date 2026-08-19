/**
 * Builds the bundled deep-sky catalogue used to annotate solved frames.
 *
 *   npm run build:catalog
 *
 * Writes catalog/deep-sky.json — committed to the repo, read from disk at
 * annotation time (not imported, so it never enters a bundle).
 *
 * Sources, all freely redistributable with acknowledgement:
 *   OpenNGC   NGC + IC + Messier   CC-BY-SA-4.0   github.com/mattiaverga/OpenNGC
 *   VII/20    Sharpless (Sh2)      Sharpless 1959, via VizieR (CDS)
 *   VII/9     Lynds Bright Nebulae Lynds 1965,     via VizieR (CDS)
 *   VII/7A    Lynds Dark Nebulae   Lynds 1962,     via VizieR (CDS)
 */
import fs from "node:fs/promises";
import path from "node:path";

type Entry = [name: string, ra: number, dec: number, diamArcmin: number, type: string];

const OUT = path.join(process.cwd(), "catalog", "deep-sky.json");

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
