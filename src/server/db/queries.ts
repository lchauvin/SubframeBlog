import "server-only";

import { asc, desc, eq, inArray, like, or } from "drizzle-orm";

import { formatMonthYear } from "@/lib/format";
import type { SearchDoc } from "@/lib/search";
import { db } from "./client";
import {
  annotations,
  frameFilters,
  frameGear,
  frameImages,
  frameTiles,
  frames,
  gearItems,
  nights,
  plateSolves,
  siteSettings,
  siteStats,
  type Frame,
} from "./schema";

import {
  classifyRevision,
  groupChain,
  opticalGearOf,
  type RevisionInput,
  type RevisionVerdict,
} from "../revisions";

export type ImageRef = { src: string; width: number; height: number };
/** Both encodings of one derivative, so the markup can offer WebP with a JPEG fallback. */
export type VariantImages = { webp?: ImageRef; jpeg?: ImageRef };
export type ImageSet = Partial<
  Record<"master" | "viewer" | "article" | "thumb" | "download", VariantImages>
>;

export const mediaUrl = (relPath: string) =>
  `/media/${relPath.split("/").map(encodeURIComponent).join("/")}`;

function toImageSet(rows: (typeof frameImages.$inferSelect)[]): ImageSet {
  const set: ImageSet = {};
  for (const r of rows) {
    const variant = r.variant as keyof ImageSet;
    const bucket = (set[variant] ??= {});
    const ref: ImageRef = { src: mediaUrl(r.path), width: r.width, height: r.height };
    if (r.format === "webp") bucket.webp = ref;
    else bucket.jpeg = ref;
  }
  return set;
}

/** Best available rendition, preferring the requested variant then coarser ones. */
export function pickImage(set: ImageSet, preferred: "viewer" | "article" | "thumb"): VariantImages {
  const order: ("viewer" | "article" | "thumb" | "master")[] =
    preferred === "thumb"
      ? ["thumb", "article", "viewer", "master"]
      : preferred === "article"
        ? ["article", "viewer", "thumb", "master"]
        : ["viewer", "article", "thumb", "master"];
  for (const v of order) if (set[v]?.jpeg || set[v]?.webp) return set[v]!;
  return {};
}

async function imageSetsFor(frameIds: number[]): Promise<Map<number, ImageSet>> {
  const map = new Map<number, ImageSet>();
  if (frameIds.length === 0) return map;

  const rows = await db.select().from(frameImages).where(inArray(frameImages.frameId, frameIds));
  const grouped = new Map<number, (typeof frameImages.$inferSelect)[]>();
  for (const r of rows) {
    const list = grouped.get(r.frameId) ?? [];
    list.push(r);
    grouped.set(r.frameId, list);
  }
  for (const [id, list] of grouped) map.set(id, toImageSet(list));
  return map;
}

export type FrameListItem = Frame & { images: ImageSet };

const frameListOrder = [asc(frames.sortIndex), desc(frames.capturedOn), desc(frames.id)] as const;

/** Gallery / admin order: manual sort index, then newest capture date. */
export async function listPublishedFrames(): Promise<FrameListItem[]> {
  const rows = await db
    .select()
    .from(frames)
    .where(eq(frames.published, true))
    .orderBy(...frameListOrder);

  const images = await imageSetsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, images: images.get(r.id) ?? {} }));
}

export async function listAllFrames(): Promise<FrameListItem[]> {
  const rows = await db
    .select()
    .from(frames)
    .orderBy(...frameListOrder);
  const images = await imageSetsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, images: images.get(r.id) ?? {} }));
}

export type FullFrame = Frame & {
  images: ImageSet;
  filters: (typeof frameFilters.$inferSelect)[];
  nights: (typeof nights.$inferSelect)[];
  annotations: (typeof annotations.$inferSelect)[];
  gear: (typeof frameGear.$inferSelect)[];
  /** null when the frame has no pyramid — the viewer then serves the base alone. */
  tiles: typeof frameTiles.$inferSelect | null;
};

async function hydrate(frame: Frame): Promise<FullFrame> {
  let filterRows: (typeof frameFilters.$inferSelect)[];
  let nightRows: (typeof nights.$inferSelect)[];
  let annotationRows: (typeof annotations.$inferSelect)[];
  let gearRows: (typeof frameGear.$inferSelect)[];
  let images: Map<number, ImageSet>;
  let tileRow: (typeof frameTiles.$inferSelect) | undefined;
  try {
    [filterRows, nightRows, annotationRows, gearRows, images, tileRow] = await Promise.all([
      db
        .select()
        .from(frameFilters)
        .where(eq(frameFilters.frameId, frame.id))
        .orderBy(asc(frameFilters.position), asc(frameFilters.id)),
      db
        .select()
        .from(nights)
        .where(eq(nights.frameId, frame.id))
        .orderBy(asc(nights.nightDate), asc(nights.position), asc(nights.id)),
      db
        .select()
        .from(annotations)
        .where(eq(annotations.frameId, frame.id))
        .orderBy(asc(annotations.position), asc(annotations.id)),
      db
        .select()
        .from(frameGear)
        .where(eq(frameGear.frameId, frame.id))
        .orderBy(asc(frameGear.position), asc(frameGear.id)),
      imageSetsFor([frame.id]),
      db.select().from(frameTiles).where(eq(frameTiles.frameId, frame.id)).get(),
    ]);
  } catch (error) {
    console.error(
      `[astroblog] Failed to hydrate frame ${frame.id} (${frame.slug}).`,
      error,
    );
    throw error;
  }

  return {
    ...frame,
    images: images.get(frame.id) ?? {},
    filters: filterRows,
    nights: nightRows,
    annotations: annotationRows,
    gear: gearRows,
    tiles: tileRow ?? null,
  };
}

export async function getFrameBySlug(slug: string): Promise<FullFrame | null> {
  const frame = await db.select().from(frames).where(eq(frames.slug, slug)).get();
  return frame ? hydrate(frame) : null;
}

export async function getFrameById(id: number): Promise<FullFrame | null> {
  const frame = await db.select().from(frames).where(eq(frames.id, id)).get();
  return frame ? hydrate(frame) : null;
}

/** The four thumbs under an article, taken from neighbours in gallery order. */
export async function getAdjacentFrames(frameId: number, limit = 4): Promise<FrameListItem[]> {
  const rows = await db
    .select()
    .from(frames)
    .where(eq(frames.published, true))
    .orderBy(...frameListOrder);

  const index = rows.findIndex((r) => r.id === frameId);
  const before = index > 0 ? rows.slice(Math.max(0, index - 2), index) : [];
  const after = rows.slice(index + 1, index + 1 + Math.max(0, limit - before.length));
  const picked = [...before, ...after].slice(0, limit);
  const images = await imageSetsFor(picked.map((r) => r.id));
  return picked.map((r) => ({ ...r, images: images.get(r.id) ?? {} }));
}

/** Slugs of published frames — drives generateStaticParams for the export. */
export async function listPublishedSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: frames.slug })
    .from(frames)
    .where(eq(frames.published, true));
  return rows.map((r) => r.slug);
}

/**
 * Published frames with whatever positional evidence exists for each, for the
 * sky atlas. The solve is LEFT JOINed because a frame with no solve still has
 * to appear on the chart — its authored coordinates are the fallback.
 */
export type AtlasFrameRow = {
  id: number;
  slug: string;
  catalogId: string;
  commonName: string;
  revision: string;
  capturedOn: string;
  palette: string;
  totalIntegrationMinutes: number;
  plateConstellation: string;
  plateCoordinates: string;
  solveStatus: string | null;
  centerRa: number | null;
  centerDec: number | null;
  radiusDeg: number | null;
  wcsJson: string | null;
  images: ImageSet;
};

export async function listAtlasFrames(): Promise<AtlasFrameRow[]> {
  const rows = await db
    .select({
      id: frames.id,
      slug: frames.slug,
      catalogId: frames.catalogId,
      commonName: frames.commonName,
      revision: frames.revision,
      capturedOn: frames.capturedOn,
      palette: frames.palette,
      totalIntegrationMinutes: frames.totalIntegrationMinutes,
      plateConstellation: frames.plateConstellation,
      plateCoordinates: frames.plateCoordinates,
      solveStatus: plateSolves.status,
      centerRa: plateSolves.centerRa,
      centerDec: plateSolves.centerDec,
      radiusDeg: plateSolves.radiusDeg,
      wcsJson: plateSolves.wcsJson,
    })
    .from(frames)
    .leftJoin(plateSolves, eq(plateSolves.frameId, frames.id))
    .where(eq(frames.published, true))
    .orderBy(...frameListOrder);

  const images = await imageSetsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, images: images.get(r.id) ?? {} }));
}

/**
 * The header search index. Only the fields a query can match plus what the
 * result row draws — the whole thing is serialised into every page, so the
 * article prose stays out of it deliberately.
 */
export async function listSearchDocs(): Promise<SearchDoc[]> {
  const rows = await db
    .select({
      id: frames.id,
      slug: frames.slug,
      catalogId: frames.catalogId,
      commonName: frames.commonName,
      capturedOn: frames.capturedOn,
      palette: frames.palette,
      plateConstellation: frames.plateConstellation,
      plateClass: frames.plateClass,
    })
    .from(frames)
    .where(eq(frames.published, true))
    .orderBy(...frameListOrder);

  const images = await imageSetsFor(rows.map((r) => r.id));

  return rows.map((r) => {
    const thumb = pickImage(images.get(r.id) ?? {}, "thumb");
    const ref = thumb.webp ?? thumb.jpeg;
    return {
      slug: r.slug,
      catalogId: r.catalogId,
      commonName: r.commonName,
      constellation: r.plateConstellation,
      objectClass: r.plateClass,
      palette: r.palette,
      dateLabel: formatMonthYear(r.capturedOn),
      thumb: ref
        ? {
            webp: thumb.webp?.src,
            jpeg: thumb.jpeg?.src,
            width: ref.width,
            height: ref.height,
          }
        : null,
    };
  });
}

/** Raw derivative rows, for the admin's upload summary (needs bytes/format). */
export async function getFrameImageRows(frameId: number) {
  return db
    .select()
    .from(frameImages)
    .where(eq(frameImages.frameId, frameId))
    .orderBy(asc(frameImages.id));
}

export async function getSiteSettings() {
  const row = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).get();
  return row ?? null;
}

export async function getGearItems() {
  return db.select().from(gearItems).orderBy(asc(gearItems.position), asc(gearItems.id));
}

export async function getSiteStats() {
  return db.select().from(siteStats).orderBy(asc(siteStats.position), asc(siteStats.id));
}

/**
 * The gallery subhead. Computed from stored frame totals — unlike the six About
 * stats, which are hand-edited because the night log is optional.
 */
export async function getLogSummary() {
  const rows = await db
    .select({ minutes: frames.totalIntegrationMinutes, capturedOn: frames.capturedOn })
    .from(frames)
    .where(eq(frames.published, true));

  const years = rows
    .map((r) => Number(r.capturedOn.slice(0, 4)))
    .filter((y) => Number.isFinite(y));

  return {
    frameCount: rows.length,
    totalHours: Math.round(rows.reduce((sum, r) => sum + r.minutes, 0) / 60),
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
  };
}

/** True when `slug` is taken by some frame other than `exceptId`. */
export async function slugExists(slug: string, exceptId?: number): Promise<boolean> {
  const row = await db
    .select({ id: frames.id })
    .from(frames)
    .where(eq(frames.slug, slug))
    .get();
  return Boolean(row) && row!.id !== exceptId;
}

/** A frame plus everything `classifyRevision` needs to judge it. */
async function revisionInputsFor(frameIds: number[]): Promise<Map<number, RevisionInput>> {
  const map = new Map<number, RevisionInput>();
  if (frameIds.length === 0) return map;

  const [frameRows, gearRows, filterRows, nightRows, solveRows] = await Promise.all([
    db.select().from(frames).where(inArray(frames.id, frameIds)),
    db.select().from(frameGear).where(inArray(frameGear.frameId, frameIds)),
    db.select().from(frameFilters).where(inArray(frameFilters.frameId, frameIds)),
    db.select().from(nights).where(inArray(nights.frameId, frameIds)),
    db.select().from(plateSolves).where(inArray(plateSolves.frameId, frameIds)),
  ]);

  for (const f of frameRows) {
    const solve = solveRows.find((s) => s.frameId === f.id && s.status === "solved");
    map.set(f.id, {
      slug: f.slug,
      capturedOn: f.capturedOn,
      palette: f.palette,
      bandwidth: f.bandwidth,
      totalIntegrationMinutes: f.totalIntegrationMinutes,
      // The solver's own scale, never `frames.arcsecPerPx`, which is a
      // hand-entered display chip and does not reconcile with the solve.
      pixScale: solve?.pixScale ?? null,
      opticalGear: opticalGearOf(gearRows.filter((g) => g.frameId === f.id)),
      filters: filterRows.filter((r) => r.frameId === f.id),
      nightCount: nightRows.filter((n) => n.frameId === f.id).length,
      revisionKind: f.revisionKind,
    });
  }
  return map;
}

export type FrameGroup = {
  head: FrameListItem;
  members: FrameListItem[];
  verdicts: (RevisionVerdict | null)[];
  /** Summed across the group, so a collapsed row can show the real total. */
  totalMinutes: number;
};

/**
 * The public log, with revisions of one target folded into a single entry.
 *
 * Frames link to the processing they revise through `parentFrameId`; a chain is
 * every frame on one of those links, oldest first. `groupChain` then splits a
 * chain wherever a hop only *accompanies* its parent — a different rig or a
 * different palette is another photograph of the target, not a replacement for
 * the one before it, so both keep their row.
 *
 * Group order follows the head frame's position in the existing gallery order,
 * so `sortIndex` keeps working untouched.
 */
export async function listPublishedFrameGroups(): Promise<FrameGroup[]> {
  const rows = await listPublishedFrames();
  const inputs = await revisionInputsFor(rows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Chain roots are frames whose parent is absent or unpublished — an
  // unpublished parent must not drag its published child out of the log.
  const children = new Map<number, FrameListItem[]>();
  const roots: FrameListItem[] = [];
  for (const row of rows) {
    const parent = row.parentFrameId != null ? byId.get(row.parentFrameId) : undefined;
    if (!parent) roots.push(row);
    else children.set(parent.id, [...(children.get(parent.id) ?? []), row]);
  }

  const order = new Map(rows.map((r, i) => [r.id, i]));
  const groups: FrameGroup[] = [];

  for (const root of roots) {
    // Walk the chain oldest first. Where a frame has several children — the
    // same processing revised twice — each branch is its own chain.
    const walk = (node: FrameListItem, chain: FrameListItem[]) => {
      const next = [...chain, node];
      const kids = (children.get(node.id) ?? []).sort((a, b) =>
        a.capturedOn < b.capturedOn ? -1 : a.capturedOn > b.capturedOn ? 1 : a.id - b.id,
      );
      if (kids.length === 0) {
        for (const g of groupChain(next, (f) => inputs.get(f.id)!)) {
          groups.push({
            head: g.head,
            members: g.members,
            verdicts: g.verdicts,
            totalMinutes: g.members.reduce((s, m) => s + m.totalIntegrationMinutes, 0),
          });
        }
        return;
      }
      for (const kid of kids) walk(kid, next);
    };
    walk(root, []);
  }

  // De-duplicate: branching chains share their trunk, so a frame can land in
  // more than one group. The group whose head it is wins; otherwise the first.
  const claimed = new Set<number>();
  const unique: FrameGroup[] = [];
  for (const g of groups.sort((a, b) => (order.get(a.head.id) ?? 0) - (order.get(b.head.id) ?? 0))) {
    if (claimed.has(g.head.id)) continue;
    claimed.add(g.head.id);
    unique.push(g);
  }
  return unique;
}

/** Every frame sharing a target with this one, oldest first, with verdicts. */
export async function getRevisionChain(frameId: number): Promise<{
  members: FrameListItem[];
  verdicts: (RevisionVerdict | null)[];
} | null> {
  const all = await listAllFrames();
  const byId = new Map(all.map((r) => [r.id, r]));
  const target = byId.get(frameId);
  if (!target) return null;

  // Climb to the root, then walk back down through this frame's own branch.
  const ancestry: FrameListItem[] = [];
  let cursor: FrameListItem | undefined = target;
  const guard = new Set<number>();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    ancestry.unshift(cursor);
    cursor = cursor.parentFrameId != null ? byId.get(cursor.parentFrameId) : undefined;
  }

  const descendants: FrameListItem[] = [];
  let frontier = [target];
  while (frontier.length > 0) {
    const next = all
      .filter((f) => frontier.some((p) => p.id === f.parentFrameId))
      .sort((a, b) => (a.capturedOn < b.capturedOn ? -1 : 1));
    descendants.push(...next);
    frontier = next;
  }

  const members = [...ancestry, ...descendants];
  if (members.length <= 1) return null;

  const inputs = await revisionInputsFor(members.map((m) => m.id));
  const verdicts: (RevisionVerdict | null)[] = members.map((m, i) =>
    i === 0 ? null : classifyRevision(inputs.get(members[i - 1].id)!, inputs.get(m.id)!),
  );
  return { members, verdicts };
}

/**
 * The next free revision slug for a target, and the frame it revises.
 *
 * `frameSlug()` returns the same slug for two frames of one target when the
 * revision field is empty, which is the state both `IC 63` drafts are in: the
 * second import is refused with a slug-collision error and has to be
 * hand-edited before it can exist at all. A second processing of a target is
 * the normal case, not a mistake, so it gets a letter instead of an error.
 *
 * The parent is the newest frame already using the base slug family, which is
 * by definition another processing of the same target.
 */
export async function nextRevisionSlug(
  baseSlug: string,
): Promise<{ slug: string; parentId: number | null }> {
  const family = await db
    .select({ id: frames.id, slug: frames.slug, capturedOn: frames.capturedOn })
    .from(frames)
    .where(or(eq(frames.slug, baseSlug), like(frames.slug, `${baseSlug}-%`)));

  const taken = new Set(family.map((f) => f.slug));

  // b onwards: the first frame of a target keeps the bare slug, so its first
  // revision is "b" rather than "a" — a lone `ic-63-a` with no `ic-63` would be
  // a strange thing to produce.
  let slug = baseSlug;
  for (let i = 1; taken.has(slug) && i < 26; i++) {
    slug = `${baseSlug}-${String.fromCharCode(97 + i)}`;
  }

  const parent = family
    .filter((f) => f.slug === baseSlug || /-[a-z]$/.test(f.slug))
    .sort((a, b) => (a.capturedOn < b.capturedOn ? 1 : a.capturedOn > b.capturedOn ? -1 : b.id - a.id))[0];

  return { slug, parentId: parent?.id ?? null };
}
