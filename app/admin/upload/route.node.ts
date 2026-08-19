import { eq } from "drizzle-orm";

import { getCurrentAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { frames } from "@/server/db/schema";
import { processMaster } from "@/server/media/derivatives";
import { queueSolve } from "@/server/astrometry/solve";
import { isConfigured } from "@/server/astrometry/client";

/** Masters run 7–12MB, well past the ~1MB default cap on server actions —
 *  hence a route handler rather than an action. */
const MAX_BYTES = 120 * 1024 * 1024;

const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ error: "Not signed in." }, { status: 401 });

  // Server actions get Next's built-in origin check; this hand-rolled POST does not.
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) {
        return Response.json({ error: "Bad origin." }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Bad origin." }, { status: 403 });
    }
  }

  const form = await request.formData();
  const frameId = Number(form.get("frameId"));
  const file = form.get("file");

  if (!Number.isFinite(frameId)) {
    return Response.json({ error: "Missing frame id." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File is ${(file.size / 1024 / 1024).toFixed(0)}MB; the limit is 120MB.` },
      { status: 413 },
    );
  }
  if (file.type && !ACCEPTED.has(file.type)) {
    return Response.json(
      { error: `Unsupported type "${file.type}". Use JPEG, PNG, TIFF or WebP.` },
      { status: 415 },
    );
  }

  const frame = await db.select().from(frames).where(eq(frames.id, frameId)).get();
  if (!frame) return Response.json({ error: "That frame no longer exists." }, { status: 404 });

  try {
    const result = await processMaster({
      frameId,
      slug: frame.slug,
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
    });

    // Fire-and-forget: solving takes minutes, so it must not hold the upload
    // response. Progress and outcome are tracked on the plate_solves row.
    const solving = isConfigured();
    if (solving) queueSolve(frameId);

    return Response.json({
      ok: true,
      width: result.master.width,
      height: result.master.height,
      derivatives: result.generated.length,
      solving,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not process that image." },
      { status: 422 },
    );
  }
}
