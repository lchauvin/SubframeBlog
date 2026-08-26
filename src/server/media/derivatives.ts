import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { frameImages } from "../db/schema";
import { MEDIA_ROOT } from "../paths";

/**
 * AVIF is deliberately absent: encoding a ~6000px master to AVIF costs far more
 * time than it saves bytes over WebP at these sizes.
 */
/**
 * `chroma` and `keepIcc` are set per variant rather than globally.
 *
 * sharp's JPEG default is 4:2:0 — colour stored at half resolution on each
 * axis. On a normal photograph that is invisible; on these it is not. Small
 * coloured stars and Ha/OIII boundaries are exactly the high-frequency chroma
 * subsampling discards, and it shows as mushy star colour and haloing once you
 * zoom. The masters are 4:4:4, so 4:2:0 here was throwing away colour the
 * source actually had.
 *
 * It costs roughly 15% more bytes, which is worth it for `viewer` (zoomed to
 * 1:1) and `download` (opened in someone else's editor), and is not worth it
 * for `article` and `thumb`, which are never seen above a few hundred pixels.
 */
export const VARIANTS = [
  // JPEG only, deliberately. Lossy WebP is internally 4:2:0 with no way to opt
  // out, so serving it here would undo the chroma fix above — and the viewer
  // renders a bare <img> off the JPEG, so the WebP was never served anyway. It
  // was 3 MB per frame of export weight for nothing.
  {
    name: "viewer",
    longEdge: 6000,
    webpQuality: 90,
    jpegQuality: 92,
    formats: ["jpeg"],
    chroma: "4:4:4",
    keepIcc: true,
  },
  {
    name: "article",
    longEdge: 1600,
    webpQuality: 84,
    jpegQuality: 86,
    formats: ["webp", "jpeg"],
    chroma: "4:2:0",
    keepIcc: false,
  },
  {
    name: "thumb",
    longEdge: 600,
    webpQuality: 86,
    jpegQuality: 88,
    formats: ["webp", "jpeg"],
    chroma: "4:2:0",
    keepIcc: false,
  },
  // Backs the viewer's "Download 2048px" chip. JPEG only — it is a file people
  // save and open elsewhere, not something the page renders.
  {
    name: "download",
    longEdge: 2048,
    webpQuality: 84,
    jpegQuality: 90,
    formats: ["jpeg"],
    chroma: "4:4:4",
    keepIcc: true,
  },
] as const;

export type VariantName = (typeof VARIANTS)[number]["name"] | "master";

const frameDir = (slug: string) => path.join(MEDIA_ROOT, slug);

export type ProcessResult = {
  master: { width: number; height: number; bytes: number };
  generated: { variant: string; format: string; width: number; height: number }[];
};

/**
 * Writes the master untouched, then derives the three display sizes in both
 * WebP and JPEG. Every row records dimensions probed from the encoded file —
 * never assumed, since masters vary (the design set is 5983x3499 except
 * ic1848, which is 5983x3347, where the prototype hardcoded one pair for all).
 */
export async function processMaster(opts: {
  frameId: number;
  slug: string;
  buffer: Buffer;
  originalName?: string;
}): Promise<ProcessResult> {
  const { frameId, slug, buffer } = opts;

  const probe = await sharp(buffer, { limitInputPixels: false }).metadata();
  if (!probe.width || !probe.height) {
    throw new Error("Could not read image dimensions — is this a valid image file?");
  }
  // EXIF orientations 5-8 mean the stored buffer is rotated relative to display.
  const swapped = (probe.orientation ?? 1) >= 5;
  const masterWidth = swapped ? probe.height : probe.width;
  const masterHeight = swapped ? probe.width : probe.height;

  const dir = frameDir(slug);
  await fs.mkdir(dir, { recursive: true });

  const masterExt =
    probe.format === "png" ? "png" : probe.format === "tiff" ? "tif" : "jpg";
  const masterRel = path.posix.join(slug, `master.${masterExt}`);
  await fs.writeFile(path.join(MEDIA_ROOT, masterRel), buffer);

  const rows: (typeof frameImages.$inferInsert)[] = [
    {
      frameId,
      variant: "master",
      format: masterExt === "jpg" ? "jpeg" : masterExt,
      path: masterRel,
      width: masterWidth,
      height: masterHeight,
      bytes: buffer.byteLength,
    },
  ];
  const generated: ProcessResult["generated"] = [];

  for (const v of VARIANTS) {
    // fit:inside with equal bounds caps the long edge whatever the orientation.
    let base = sharp(buffer, { limitInputPixels: false })
      .rotate()
      .resize({ width: v.longEdge, height: v.longEdge, fit: "inside", withoutEnlargement: true });

    // sharp strips metadata by default, which drops the master's ICC profile.
    if (v.keepIcc) base = base.keepIccProfile();

    const outputs = [
      { format: "webp", ext: "webp", pipeline: () => base.clone().webp({ quality: v.webpQuality }) },
      {
        format: "jpeg",
        ext: "jpg",
        pipeline: () =>
          base.clone().jpeg({
            quality: v.jpegQuality,
            progressive: true,
            mozjpeg: true,
            chromaSubsampling: v.chroma,
          }),
      },
    ].filter((o) => (v.formats as readonly string[]).includes(o.format));

    for (const o of outputs) {
      const rel = path.posix.join(slug, `${v.name}.${o.ext}`);
      const info = await o.pipeline().toFile(path.join(MEDIA_ROOT, rel));
      rows.push({
        frameId,
        variant: v.name,
        format: o.format,
        path: rel,
        width: info.width,
        height: info.height,
        bytes: info.size,
      });
      generated.push({ variant: v.name, format: o.format, width: info.width, height: info.height });
    }
  }

  await db.delete(frameImages).where(eq(frameImages.frameId, frameId));
  await db.insert(frameImages).values(rows);

  return {
    master: { width: masterWidth, height: masterHeight, bytes: buffer.byteLength },
    generated,
  };
}

/** Removes a frame's whole media directory. Safe to call when nothing exists. */
export async function deleteFrameMedia(slug: string): Promise<void> {
  const dir = frameDir(slug);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(MEDIA_ROOT) + path.sep)) return;
  await fs.rm(resolved, { recursive: true, force: true });
}

/** Renames the media directory when a slug changes, keeping paths in step. */
export async function renameFrameMedia(oldSlug: string, newSlug: string): Promise<void> {
  if (oldSlug === newSlug) return;
  try {
    await fs.rename(frameDir(oldSlug), frameDir(newSlug));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
