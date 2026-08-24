"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authoredGearRows } from "@/lib/defaults";
import { slugify, frameSlug } from "@/lib/format";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
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
} from "@/server/db/schema";
import { slugExists } from "@/server/db/queries";
import { deleteFrameMedia, renameFrameMedia } from "@/server/media/derivatives";

export type FormState = { error?: string; success?: string };

const text = (max = 500) => z.string().trim().max(max);

const filterSchema = z.object({
  name: text(80).min(1),
  subLengthSeconds: z.coerce.number().int().min(0).max(100_000),
  keptFrames: z.coerce.number().int().min(0).max(1_000_000),
  totalFrames: z.coerce.number().int().min(0).max(1_000_000),
  hours: z.coerce.number().min(0).max(100_000),
});

const nightSchema = z.object({
  nightDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Night dates must be YYYY-MM-DD"),
  filterLabel: text(40),
  subLengthSeconds: z.coerce.number().int().min(0).max(100_000),
  kept: z.coerce.number().int().min(0).max(1_000_000),
  rejected: z.coerce.number().int().min(0).max(1_000_000),
  reason: text(120),
});

const annotationSchema = z.object({
  label: text(80).min(1),
  xPct: z.coerce.number().min(0).max(100),
  yPct: z.coerce.number().min(0).max(100),
  radiusPx: z.coerce.number().min(1).max(3200),
});

const frameGearSchema = z.object({ keyLabel: text(40), value: text(300) });

const frameSchema = z.object({
  catalogId: text(120).min(1, "Catalog ID is required"),
  commonName: text(120),
  slug: text(80),
  frameNumber: text(20),
  revision: text(10),
  capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Captured date must be YYYY-MM-DD"),
  palette: text(20),
  bandwidth: text(20),
  integrationHours: z.coerce.number().int().min(0).max(100_000),
  integrationMinutes: z.coerce.number().int().min(0).max(59),
  metaLine: text(200),
  blurb: text(1000),
  bodyMarkdown: z.string().max(20_000),
  note: text(1000),
  plateCatalog: text(200),
  plateClass: text(200),
  plateConstellation: text(200),
  plateDistance: text(200),
  plateCoordinates: text(200),
  platePalette: text(200),
  plateSessions: text(200),
  plateSky: text(200),
  opticsLabel: text(120),
  sensorLabel: text(120),
  arcsecPerPx: z.union([z.coerce.number().min(0).max(1000), z.literal("")]).optional(),
});

function parseRows<T extends z.ZodTypeAny>(raw: FormDataEntryValue | null, schema: T) {
  const parsed = JSON.parse(String(raw ?? "[]"));
  return z.array(schema).parse(parsed);
}

export async function saveFrame(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();

  const idRaw = String(formData.get("id") ?? "");
  const id = idRaw ? Number(idRaw) : null;

  let data: z.infer<typeof frameSchema>;
  let filterRows: z.infer<typeof filterSchema>[];
  let nightRows: z.infer<typeof nightSchema>[];
  let annotationRows: z.infer<typeof annotationSchema>[];
  let gearRows: z.infer<typeof frameGearSchema>[];

  try {
    data = frameSchema.parse(Object.fromEntries(formData));
    filterRows = parseRows(formData.get("filtersJson"), filterSchema);
    nightRows = parseRows(formData.get("nightsJson"), nightSchema);
    annotationRows = parseRows(formData.get("annotationsJson"), annotationSchema);
    gearRows = authoredGearRows(parseRows(formData.get("gearJson"), frameGearSchema));
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.errors[0];
      return { error: `${first.path.join(".") || "Form"}: ${first.message}` };
    }
    return { error: "Could not read the form data." };
  }

  const slug = slugify(data.slug) || frameSlug(data.catalogId, data.revision);
  if (!slug) return { error: "Could not derive a slug — give the frame a catalog ID." };
  if (await slugExists(slug, id ?? undefined)) {
    return { error: `The slug "${slug}" is already used by another frame.` };
  }

  const values = {
    slug,
    catalogId: data.catalogId,
    commonName: data.commonName,
    frameNumber: data.frameNumber,
    revision: data.revision,
    capturedOn: data.capturedOn,
    palette: data.palette,
    bandwidth: data.bandwidth,
    totalIntegrationMinutes: data.integrationHours * 60 + data.integrationMinutes,
    metaLine: data.metaLine,
    blurb: data.blurb,
    bodyMarkdown: data.bodyMarkdown,
    note: data.note,
    plateCatalog: data.plateCatalog,
    plateClass: data.plateClass,
    plateConstellation: data.plateConstellation,
    plateDistance: data.plateDistance,
    plateCoordinates: data.plateCoordinates,
    platePalette: data.platePalette,
    plateSessions: data.plateSessions,
    plateSky: data.plateSky,
    opticsLabel: data.opticsLabel,
    sensorLabel: data.sensorLabel,
    arcsecPerPx:
      data.arcsecPerPx === "" || data.arcsecPerPx === undefined ? null : Number(data.arcsecPerPx),
    published: formData.get("published") === "on",
    updatedAt: new Date(),
  };

  let frameId: number;
  let created = false;

  if (id) {
    const existing = await db.select().from(frames).where(eq(frames.id, id)).get();
    if (!existing) return { error: "That frame no longer exists." };

    // Keep media directory and stored paths in step with the slug.
    if (existing.slug !== slug) {
      await renameFrameMedia(existing.slug, slug);
      const images = await db.select().from(frameImages).where(eq(frameImages.frameId, id));
      for (const img of images) {
        await db
          .update(frameImages)
          .set({ path: img.path.replace(new RegExp(`^${existing.slug}/`), `${slug}/`) })
          .where(eq(frameImages.id, img.id));
      }
    }

    await db.update(frames).set(values).where(eq(frames.id, id));
    frameId = id;
  } else {
    const top = await db
      .select({ sortIndex: frames.sortIndex })
      .from(frames)
      .orderBy(asc(frames.sortIndex))
      .limit(1)
      .get();
    const inserted = await db
      .insert(frames)
      .values({
        ...values,
        sortIndex: top ? top.sortIndex - 1 : 0,
        createdAt: new Date(),
      })
      .returning({ id: frames.id });
    frameId = inserted[0].id;
    created = true;
  }

  // Child rows are small and fully authored in the form — replace wholesale.
  await db.delete(frameFilters).where(eq(frameFilters.frameId, frameId));
  if (filterRows.length > 0) {
    await db
      .insert(frameFilters)
      .values(filterRows.map((f, i) => ({ ...f, frameId, position: i })));
  }

  await db.delete(nights).where(eq(nights.frameId, frameId));
  if (nightRows.length > 0) {
    await db.insert(nights).values(nightRows.map((n, i) => ({ ...n, frameId, position: i })));
  }

  await db.delete(annotations).where(eq(annotations.frameId, frameId));
  if (annotationRows.length > 0) {
    await db
      .insert(annotations)
      .values(annotationRows.map((a, i) => ({ ...a, frameId, position: i })));
  }

  await db.delete(frameGear).where(eq(frameGear.frameId, frameId));
  if (gearRows.length > 0) {
    await db
      .insert(frameGear)
      .values(gearRows.map((g, i) => ({ ...g, frameId, position: i })));
  }

  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath(`/frame/${slug}`);
  revalidatePath(`/frame/${slug}/full`);
  revalidatePath("/admin");
  revalidatePath(`/admin/frames/${frameId}`);

  if (created) redirect(`/admin/frames/${frameId}?created=1`);
  return { success: "Saved." };
}

export async function deleteFrame(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;

  const frame = await db.select().from(frames).where(eq(frames.id, id)).get();
  if (!frame) return;

  await deleteFrameMedia(frame.slug);
  // Children cascade via the schema's foreign keys.
  await db.delete(frames).where(eq(frames.id, id));

  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath("/admin");
  redirect("/admin");
}

export async function togglePublish(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const frame = await db.select().from(frames).where(eq(frames.id, id)).get();
  if (!frame) return;

  await db
    .update(frames)
    .set({ published: !frame.published, updatedAt: new Date() })
    .where(eq(frames.id, id));

  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath(`/frame/${frame.slug}`);
  revalidatePath("/admin");
}

export async function moveFrame(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const direction = String(formData.get("direction"));
  if (!Number.isFinite(id) || (direction !== "up" && direction !== "down")) return;

  const rows = await db
    .select({ id: frames.id, sortIndex: frames.sortIndex })
    .from(frames)
    .orderBy(asc(frames.sortIndex), desc(frames.capturedOn), desc(frames.id));

  const index = rows.findIndex((row) => row.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= rows.length) return;

  const uniqueIndexes = new Set(rows.map((row) => row.sortIndex));
  if (uniqueIndexes.size !== rows.length) {
    for (const [position, row] of rows.entries()) {
      await db
        .update(frames)
        .set({ sortIndex: position, updatedAt: new Date() })
        .where(eq(frames.id, row.id));
      row.sortIndex = position;
    }
  }

  const current = rows[index];
  const neighbor = rows[swapWith];
  await db
    .update(frames)
    .set({ sortIndex: neighbor.sortIndex, updatedAt: new Date() })
    .where(eq(frames.id, current.id));
  await db
    .update(frames)
    .set({ sortIndex: current.sortIndex, updatedAt: new Date() })
    .where(eq(frames.id, neighbor.id));

  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath("/admin");
}

/* ---- Site settings ------------------------------------------------------- */

const siteSchema = z.object({
  siteName: text(80).min(1),
  siteTagline: text(80),
  navLogLabel: text(40).min(1),
  navAboutLabel: text(40).min(1),
  logHeading: text(80).min(1),
  logPaginationLabel: text(60),
  aboutKicker: text(40),
  aboutHeading: z.string().trim().max(200),
  aboutBody: z.string().max(8000),
  aboutRigLabel: text(60),
  aboutHeroSlug: text(80),
  aboutHeroCaption: text(160),
  printsLabel: text(60),
  printsBody: z.string().max(2000),
  printsButtonLabel: text(40),
  contactHref: text(300),
  footerLeft: text(160),
  footerRight: text(160),
});

const gearSchema = z.object({ keyLabel: text(40).min(1), value: text(300).min(1) });
const statSchema = z.object({ value: text(20).min(1), label: text(60).min(1) });

export async function saveSite(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();

  let data: z.infer<typeof siteSchema>;
  let gearRows: z.infer<typeof gearSchema>[];
  let statRows: z.infer<typeof statSchema>[];

  try {
    data = siteSchema.parse(Object.fromEntries(formData));
    gearRows = parseRows(formData.get("gearJson"), gearSchema);
    statRows = parseRows(formData.get("statsJson"), statSchema);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.errors[0];
      return { error: `${first.path.join(".") || "Form"}: ${first.message}` };
    }
    return { error: "Could not read the form data." };
  }

  const existing = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).get();
  if (existing) {
    await db
      .update(siteSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(siteSettings.id, 1));
  } else {
    await db.insert(siteSettings).values({ id: 1, ...data, updatedAt: new Date() });
  }

  await db.delete(gearItems);
  if (gearRows.length > 0) {
    await db.insert(gearItems).values(gearRows.map((g, i) => ({ ...g, position: i })));
  }

  await db.delete(siteStats);
  if (statRows.length > 0) {
    await db.insert(siteStats).values(statRows.map((s, i) => ({ ...s, position: i })));
  }

  revalidatePath("/", "layout");
  return { success: "Saved." };
}
