import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "./client";
import {
  annotations,
  frameFilters,
  frameImages,
  frames,
  gearItems,
  nights,
  siteSettings,
  siteStats,
  type Frame,
} from "./schema";

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
};

async function hydrate(frame: Frame): Promise<FullFrame> {
  let filterRows: (typeof frameFilters.$inferSelect)[];
  let nightRows: (typeof nights.$inferSelect)[];
  let annotationRows: (typeof annotations.$inferSelect)[];
  let images: Map<number, ImageSet>;
  try {
    [filterRows, nightRows, annotationRows, images] = await Promise.all([
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
      imageSetsFor([frame.id]),
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
