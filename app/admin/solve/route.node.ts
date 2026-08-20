import { asc, eq } from "drizzle-orm";

import { getCurrentAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { annotations, frames } from "@/server/db/schema";
import { isConfigured } from "@/server/astrometry/client";
import { advanceSolve, getPlateSolve, retrySolve } from "@/server/astrometry/solve";

/** Current solve state for one frame. Polled by the admin while work is in flight. */
export async function GET(request: Request) {
  if (!(await getCurrentAdmin())) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const frameId = Number(new URL(request.url).searchParams.get("frameId"));
  if (!Number.isFinite(frameId)) {
    return Response.json({ error: "Missing frame id." }, { status: 400 });
  }

  // Besides reporting status, polling advances one durable solver step. This
  // lets the admin recover a queued job even if the host suspended its timer.
  let solve = await getPlateSolve(frameId);
  if (solve?.status === "queued" || solve?.status === "solving") {
    await advanceSolve(frameId);
    solve = await getPlateSolve(frameId);
  }

  const markerRows = await db
    .select({
      label: annotations.label,
      xPct: annotations.xPct,
      yPct: annotations.yPct,
      radiusPx: annotations.radiusPx,
    })
    .from(annotations)
    .where(eq(annotations.frameId, frameId))
    .orderBy(asc(annotations.position), asc(annotations.id));

  return Response.json({
    configured: isConfigured(),
    status: solve?.status ?? "none",
    message: solve?.message ?? "",
    objectsFound: solve?.objectsFound ?? 0,
    annotationsWritten: solve?.annotationsWritten ?? 0,
    centerRa: solve?.centerRa ?? null,
    centerDec: solve?.centerDec ?? null,
    pixScale: solve?.pixScale ?? null,
    orientation: solve?.orientation ?? null,
    updatedAt: solve?.updatedAt ?? null,
    annotations: markerRows,
  });
}

/** Re-runs a solve on demand. */
export async function POST(request: Request) {
  if (!(await getCurrentAdmin())) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

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

  if (!isConfigured()) {
    return Response.json(
      { error: "ASTROMETRY_API_KEY is not set — see SETUP.md." },
      { status: 400 },
    );
  }

  const { frameId } = (await request.json()) as { frameId?: number };
  if (!Number.isFinite(frameId)) {
    return Response.json({ error: "Missing frame id." }, { status: 400 });
  }

  const frame = await db
    .select({ id: frames.id })
    .from(frames)
    .where(eq(frames.id, frameId as number))
    .get();
  if (!frame) return Response.json({ error: "That frame no longer exists." }, { status: 404 });

  await retrySolve(frame.id);
  return Response.json({ ok: true });
}
