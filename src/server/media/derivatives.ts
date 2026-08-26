import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { frameImages, frameTiles } from "../db/schema";
import { MEDIA_ROOT } from "../paths";

/** Deep Zoom geometry. 512 rather than the 256 default: a quarter of the file
 *  count, and these get uploaded to shared hosting one by one. */
export const TILE_SIZE = 512;
/** 0 keeps tile (x,y) covering exactly [x*size, (x+1)*size). See §2.10 of the
 *  plan for the seam contingency if that ever shows. */
export const TILE_OVERLAP = 0;
/**
 * How far the base derivative must be outmatched before tiles are worth it.
 *
 * Without a margin, a maximised window on a large display asks for a few
 * percent more than the base can give and switches on the whole deepest level
 * at fit — where the visible region is the entire image, so that is every tile
 * at once. A 15% tolerance absorbs those cases; a shortfall that small is not
 * visible, and a full level's worth of downloads very much is.
 */
export const TILE_ACTIVATION = 1.15;

/** DZI level dimensions, per the spec: halve and round up, from the deepest. */
export const levelSize = (fullWidth: number, fullHeight: number, maxLevel: number, level: number) => {
  const scale = 2 ** (maxLevel - level);
  return { width: Math.ceil(fullWidth / scale), height: Math.ceil(fullHeight / scale) };
};

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
  //
  // 2880px and 4:2:0 are both consequences of the tile pyramid existing. This
  // variant is now only ever seen at fit or below 1:1: the tiles take over
  // above that, so it does not need the master's resolution, and chroma
  // subsampling — which is only visible at 1:1 — costs nothing here while
  // saving 35% of the bytes on the one file every viewer open must wait for.
  // 2880 covers a 1440 CSS px image on a 2x display, which is a maximised
  // window on anything short of a 4K panel. Measured: 1.26 MB, against 1.41 MB
  // for the 4000px 4:2:0 file this replaces.
  {
    name: "viewer",
    longEdge: 2880,
    webpQuality: 90,
    jpegQuality: 92,
    formats: ["jpeg"],
    chroma: "4:2:0",
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

/**
 * Trailing markers that say a file is complete.
 *
 * A truncated image usually keeps a valid header — dimensions and format read
 * back correctly — and only fails deep in the decoder, as `vipspng: libpng read
 * error` or the JPEG equivalent. That message names the library rather than the
 * problem, and it reaches the admin verbatim, so the one thing worth knowing
 * (the file arrived incomplete) is the one thing it does not say.
 *
 * Checking the trailer is cheap and catches exactly that case. A cut-short
 * upload is by far the likeliest way to get a header-valid, body-invalid file
 * here: masters run to tens of megabytes and any proxy or host body cap in
 * front of the app truncates rather than refuses.
 */
const TRAILERS: Record<string, { bytes: Buffer; label: string }> = {
  // Zero-length IEND chunk plus its constant CRC.
  png: {
    bytes: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    label: "IEND",
  },
  // End of image.
  jpeg: { bytes: Buffer.from([0xff, 0xd9]), label: "EOI" },
};

/** How far back from the end to look for the marker. */
const TRAILER_SCAN_BYTES = 1024 * 1024;

function assertComplete(buffer: Buffer, format: string | undefined): void {
  if (!format) return;
  const trailer = TRAILERS[format];
  if (!trailer) return; // TIFF and WebP have no single reliable end marker.

  // Scanned, not compared against the final bytes: some encoders append
  // metadata or padding after the end marker, and a file that is genuinely
  // complete must never be rejected here. Erring toward accepting is the right
  // direction — a false negative costs a confusing decoder error later, a false
  // positive refuses a good master outright.
  const from = Math.max(0, buffer.byteLength - TRAILER_SCAN_BYTES);
  if (buffer.subarray(from).includes(trailer.bytes)) return;

  const mb = (buffer.byteLength / 1024 / 1024).toFixed(1);
  throw new Error(
    `This ${format.toUpperCase()} is incomplete — it has no ${trailer.label} marker at the end, ` +
      `so the last of the file is missing (received ${mb} MB). The image header is intact, which ` +
      `is why it looks like a valid file until the decoder reaches the end. This almost always ` +
      `means the upload was cut short by a request-size limit between the browser and the app ` +
      `rather than a damaged original — check the original opens elsewhere, then re-upload it.`,
  );
}

export type TileResult = {
  path: string;
  extension: string;
  tileSize: number;
  overlap: number;
  maxLevel: number;
  minLevel: number;
  width: number;
  height: number;
  tileCount: number;
  bytes: number;
};

export type ProcessResult = {
  master: { width: number; height: number; bytes: number };
  generated: { variant: string; format: string; width: number; height: number }[];
  /** null when the master is not enough bigger than the base to be worth it. */
  tiles: TileResult | null;
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
  /** false when `buffer` was read from the stored master — see below. */
  writeMaster?: boolean;
}): Promise<ProcessResult> {
  const { frameId, slug, buffer } = opts;

  const probe = await sharp(buffer, { limitInputPixels: false }).metadata();
  if (!probe.width || !probe.height) {
    throw new Error("Could not read image dimensions — is this a valid image file?");
  }
  // Before any of the work: a header-valid but truncated file would otherwise
  // get through the probe and fail several seconds later inside libpng or
  // libjpeg, with a message that names the library instead of the problem.
  assertComplete(buffer, probe.format);
  // EXIF orientations 5-8 mean the stored buffer is rotated relative to display.
  const swapped = (probe.orientation ?? 1) >= 5;
  const masterWidth = swapped ? probe.height : probe.width;
  const masterHeight = swapped ? probe.width : probe.height;

  const dir = frameDir(slug);
  await fs.mkdir(dir, { recursive: true });

  const masterExt =
    probe.format === "png" ? "png" : probe.format === "tiff" ? "tif" : "jpg";
  const masterRel = path.posix.join(slug, `master.${masterExt}`);
  /**
   * Only an upload writes the master. A re-derive reads the master off disk and
   * hands the same bytes back, so writing them again achieves nothing and puts
   * the one irreplaceable file in the frame directory through a write it did not
   * need — on a full disk or a killed process, that is how you lose an original
   * while trying to regenerate thumbnails from it.
   */
  if (opts.writeMaster !== false) {
    /**
     * Written to a temporary name and renamed into place, because `writeFile`
     * of a 40MB buffer is not instant and is not atomic: anything reading
     * `master.png` while it is in flight gets however much has landed so far.
     * A rebuild started during an upload of the same frame does exactly that,
     * and a partial read looks precisely like a truncated file — valid header,
     * missing end marker — which is a confusing thing to be told about a file
     * that is perfectly fine a second later.
     *
     * `rename` within the same directory is atomic, so a reader sees either the
     * previous master or the new one, never half of either.
     */
    const finalPath = path.join(MEDIA_ROOT, masterRel);
    const tempPath = `${finalPath}.uploading-${process.pid}-${frameId}`;
    try {
      await fs.writeFile(tempPath, buffer);
      await fs.rename(tempPath, finalPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

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

  // The base the tile floor is measured against is the derivative that was
  // actually written, not the configured long edge — `withoutEnlargement`
  // means a small master produces a smaller base than requested.
  const baseWidth =
    generated.find((g) => g.variant === "viewer" && g.format === "jpeg")?.width ?? masterWidth;

  const tiles = await generateTiles({
    frameId,
    slug,
    buffer,
    baseWidth,
    fullWidth: masterWidth,
    fullHeight: masterHeight,
  });

  await pruneStaleDerivatives(slug, rows.map((r) => r.path));

  return {
    master: { width: masterWidth, height: masterHeight, bytes: buffer.byteLength },
    generated,
    tiles,
  };
}

/**
 * Writes the Deep Zoom pyramid, keeping only the levels the base derivative
 * cannot already cover.
 *
 * libvips emits every level from 1x1 up, and for a 21 MP master all but the
 * deepest are redundant the moment a 2880px base exists — they cost ~2.5 MB and
 * 44 files per frame to ship something the base image already shows. Pruning
 * them also collapses level switching to a single transition, which is the part
 * of a hand-rolled tile viewer most likely to flicker.
 */
async function generateTiles(opts: {
  frameId: number;
  slug: string;
  buffer: Buffer;
  baseWidth: number;
  fullWidth: number;
  fullHeight: number;
}): Promise<TileResult | null> {
  const { frameId, slug, buffer, baseWidth, fullWidth, fullHeight } = opts;

  const dir = frameDir(slug);
  const tilesDir = path.join(dir, "tiles_files");

  await db.delete(frameTiles).where(eq(frameTiles.frameId, frameId));
  await fs.rm(tilesDir, { recursive: true, force: true });
  await fs.rm(path.join(dir, "tiles.dzi"), { force: true });

  // Nothing above the base to serve — a small master, or one the base already
  // reproduces pixel for pixel.
  if (fullWidth <= baseWidth * TILE_ACTIVATION) return null;

  await sharp(buffer, { limitInputPixels: false })
    .rotate()
    .keepIccProfile()
    // 4:4:4 here and nowhere else: tiles are the only thing ever seen at 1:1.
    .jpeg({ quality: 90, progressive: true, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .tile({ layout: "dz", size: TILE_SIZE, overlap: TILE_OVERLAP })
    .toFile(path.join(dir, "tiles.dz"));

  // Never read back: the client computes every URL arithmetically, so parsing
  // it would only add a round trip and a content type to the media route.
  await fs.rm(path.join(dir, "tiles.dzi"), { force: true });

  const levels = (await fs.readdir(tilesDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => Number(e.name))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  if (levels.length === 0) return null;
  const maxLevel = levels[levels.length - 1];

  let minLevel = maxLevel;
  let tileCount = 0;
  let bytes = 0;
  let extension = "jpeg";

  for (const level of levels) {
    const { width } = levelSize(fullWidth, fullHeight, maxLevel, level);
    const levelDir = path.join(tilesDir, String(level));

    if (width <= baseWidth * TILE_ACTIVATION) {
      await fs.rm(levelDir, { recursive: true, force: true });
      continue;
    }

    minLevel = Math.min(minLevel, level);
    for (const file of await fs.readdir(levelDir)) {
      // Measured, not assumed — libvips overrides a requested suffix with the
      // pipeline's own format, so these land as .jpeg rather than .jpg.
      extension = path.extname(file).replace(/^\./, "") || extension;
      tileCount += 1;
      bytes += (await fs.stat(path.join(levelDir, file))).size;
    }
  }

  const result: TileResult = {
    path: path.posix.join(slug, "tiles_files"),
    extension,
    tileSize: TILE_SIZE,
    overlap: TILE_OVERLAP,
    maxLevel,
    minLevel,
    width: fullWidth,
    height: fullHeight,
    tileCount,
    bytes,
  };

  await db.insert(frameTiles).values({ frameId, ...result });
  return result;
}

/**
 * Deletes derivative files in the frame's own directory that this run did not
 * write.
 *
 * `frame_images` rows are replaced wholesale, but the files were not, so
 * removing a variant left orphans on disk that the static export still copied
 * and uploaded. Dropping `viewer.webp` left five of those, 2-3 MB each.
 *
 * Deliberately shallow: the master is kept whatever its extension, and
 * `tiles_files/` is a directory this never recurses into — that pyramid is
 * pruned by the function that writes it.
 */
async function pruneStaleDerivatives(slug: string, keepPaths: string[]): Promise<void> {
  const dir = frameDir(slug);
  const keep = new Set(keepPaths.map((p) => path.posix.basename(p)));

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith("master.")) continue;
    // A concurrent upload's half-written master, which is about to be renamed
    // into place by whoever owns it.
    if (entry.name.includes(".uploading-")) continue;
    if (keep.has(entry.name)) continue;
    await fs.rm(path.join(dir, entry.name), { force: true });
  }
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
