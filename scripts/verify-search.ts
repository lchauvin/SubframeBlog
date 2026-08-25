/**
 * Checks the header search matcher against the configured database.
 *
 *   npm run check:search
 *   ASTROBLOG_DATA_DIR=... npm run check:search
 *
 * The ranking assertions are the point. A matcher that merely substring-tests
 * looks fine on a five-frame log — every query still returns *something* — and
 * only goes wrong once two targets share a constellation, so the ordering the
 * design implies ("cas" surfaces Cassiopeia first) is asserted explicitly
 * rather than eyeballed.
 */
import { searchFrames } from "../src/lib/search";
import { listSearchDocs } from "../src/server/db/queries";

let failures = 0;

/** `detail` is remediation, so it prints only on failure. */
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
};

const docs = await listSearchDocs();
console.log(`\nSearch index — ${docs.length} published frame(s)\n`);

const ids = (query: string) => searchFrames(docs, query).map((h) => h.doc.catalogId);

check("index is not empty", docs.length > 0, "seed the database first: npm run seed");

if (docs.length > 0) {
  const first = docs[0];

  // Every doc must be reachable by the two names a reader actually knows it by.
  for (const doc of docs) {
    check(
      `"${doc.catalogId}" finds itself`,
      ids(doc.catalogId)[0] === doc.catalogId,
      `got ${ids(doc.catalogId).join(", ") || "nothing"}`,
    );
    if (doc.commonName) {
      check(
        `"${doc.commonName}" finds ${doc.catalogId}`,
        ids(doc.commonName).includes(doc.catalogId),
        `got ${ids(doc.commonName).join(", ") || "nothing"}`,
      );
    }
  }

  // Punctuation-insensitivity: the whole reason the matcher keeps a compact
  // form. "ngc6888" is how a catalog id gets typed in a hurry.
  const squashed = first.catalogId.replace(/[^A-Za-z0-9]/g, "");
  check(
    `"${squashed}" (no separators) finds ${first.catalogId}`,
    ids(squashed).includes(first.catalogId),
    `got ${ids(squashed).join(", ") || "nothing"}`,
  );

  // A prefix must rank the frame it anchors above one it merely brushes.
  const prefix = first.catalogId.slice(0, 3);
  check(
    `prefix "${prefix}" ranks ${first.catalogId} first`,
    ids(prefix)[0] === first.catalogId,
    `got ${ids(prefix).join(", ") || "nothing"}`,
  );

  // Tokens are ANDed: a second word narrows, never widens.
  const constellation = docs.find((d) => d.constellation)?.constellation ?? "";
  if (constellation) {
    const word = constellation.split(/\s+/)[0];
    const broad = ids(word);
    const narrow = ids(`${word} ${first.catalogId}`);
    check(
      `"${word} ${first.catalogId}" narrows "${word}"`,
      narrow.length <= broad.length,
      `${broad.length} -> ${narrow.length}`,
    );
  }

  check("an empty query lists recent frames", searchFrames(docs, "").length > 0);
  check("whitespace is treated as empty", searchFrames(docs, "   ").length > 0);
  check("gibberish matches nothing", ids("zzqqxx").length === 0, ids("zzqqxx").join(", "));

  // The index is serialised into every page; keep an eye on what that costs.
  const bytes = Buffer.byteLength(JSON.stringify(docs), "utf8");
  check(
    `index payload is small (${(bytes / 1024).toFixed(1)} KB)`,
    bytes < 64 * 1024,
    "over 64 KB — consider fetching the index instead of inlining it",
  );
}

console.log(failures === 0 ? "\nAll search checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
