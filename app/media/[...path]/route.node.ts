import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { MEDIA_ROOT } from "@/server/paths";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/**
 * Serves `data/media`, which sits outside `public/` because files written after
 * the build are not reliably served from there.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  const root = path.resolve(MEDIA_ROOT);
  const target = path.resolve(root, ...segments.map((s) => decodeURIComponent(s)));

  // Traversal guard: resolve first, then require the result to be inside root.
  if (target !== root && !target.startsWith(root + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return new Response("Not found", { status: 404 });

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (_request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const stream = Readable.toWeb(fs.createReadStream(target)) as WebReadableStream<Uint8Array>;

  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      ETag: etag,
    },
  });
}
