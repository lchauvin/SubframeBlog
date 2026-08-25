/**
 * Frame search — index shape and matcher.
 *
 * Deliberately dependency-free and isomorphic: the static export has no server
 * to query, so the whole index is serialised into the page and matched in the
 * browser. With the log in the tens of frames a linear scan is far cheaper than
 * shipping a search library, so there is no inverted index here.
 */

export type SearchDoc = {
  slug: string;
  catalogId: string;
  commonName: string;
  constellation: string;
  objectClass: string;
  palette: string;
  dateLabel: string;
  thumb: { webp?: string; jpeg?: string; width: number; height: number } | null;
};

export type SearchHit = { doc: SearchDoc; score: number };

/**
 * Lowercased, unaccented, punctuation collapsed to single spaces. "Sh2-114"
 * and "NGC 6888" both become word-separated so a prefix test can see the parts.
 */
function normalize(input: string): string {
  return (input ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same, with separators removed, so "ngc6888" can match "NGC 6888". */
const compact = (input: string) => normalize(input).replace(/ /g, "");

/**
 * Field weights. Catalog id and common name are how a frame is actually named,
 * so they outrank the sky metadata a query might only incidentally brush.
 */
const FIELDS: { key: keyof SearchDoc; weight: number }[] = [
  { key: "catalogId", weight: 100 },
  { key: "commonName", weight: 80 },
  { key: "constellation", weight: 60 },
  { key: "objectClass", weight: 50 },
  { key: "palette", weight: 40 },
  { key: "dateLabel", weight: 30 },
];

/**
 * How well one query token sits in one field, as a 0–1 multiplier:
 * a whole-field hit beats a leading hit, which beats a hit at a word boundary,
 * which beats an arbitrary substring. Anchored matches rank first because
 * "cas" should surface Cassiopeia ahead of anything merely containing "cas".
 */
function fieldScore(field: string, token: string): number {
  if (!field || !token) return 0;

  const nField = normalize(field);
  const nToken = normalize(token);
  if (nField && nToken) {
    if (nField === nToken) return 1;
    if (nField.startsWith(nToken)) return 0.85;
    if (nField.includes(` ${nToken}`)) return 0.7;
    if (nField.includes(nToken)) return 0.45;
  }

  // Punctuation-insensitive fallback: "ngc6888" / "sh2114" typed without spaces.
  const cField = nField.replace(/ /g, "");
  const cToken = nToken.replace(/ /g, "");
  if (cField && cToken) {
    if (cField === cToken) return 0.95;
    if (cField.startsWith(cToken)) return 0.8;
    if (cField.includes(cToken)) return 0.4;
  }

  return 0;
}

/**
 * Every token must land somewhere (AND), each scoring against its best field.
 * A token that matches nothing rejects the document outright, so "cygnus 2025"
 * narrows rather than widening the way an OR would.
 */
function scoreDoc(doc: SearchDoc, tokens: string[]): number {
  let total = 0;

  for (const token of tokens) {
    let best = 0;
    for (const { key, weight } of FIELDS) {
      const value = doc[key];
      if (typeof value !== "string") continue;
      best = Math.max(best, fieldScore(value, token) * weight);
    }
    if (best === 0) return 0;
    total += best;
  }

  return total;
}

export const SEARCH_LIMIT = 8;

/**
 * Ranked matches, best first. An empty query yields the most recent frames —
 * `docs` arrives in the gallery's own order, so "recent" is just the head of it.
 * Ties keep that incoming order, which keeps results stable as you type.
 */
export function searchFrames(docs: SearchDoc[], query: string, limit = SEARCH_LIMIT): SearchHit[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return docs.slice(0, limit).map((doc) => ({ doc, score: 0 }));

  return docs
    .map((doc, index) => ({ doc, score: scoreDoc(doc, tokens), index }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ doc, score }) => ({ doc, score }));
}

/** Exported for the unit check in `scripts/verify-search.ts`. */
export const __internals = { normalize, compact, fieldScore, scoreDoc };
