import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";

import { fieldRadiusDegrees, parseRaDec } from "../../lib/coordinates";
import { db } from "../db/client";
import { annotations, frameImages, frames, plateSolves } from "../db/schema";
import { MEDIA_ROOT } from "../paths";
import {
  getAnnotations,
  getCalibration,
  isConfigured,
  login,
  uploadImage,
  waitForJob,
} from "./client";
import { selectAnnotations } from "./objects";
import { catalogAvailable, markersForFrame } from "./catalog";
import { fetchWcs, type Wcs } from "./wcs";

export const MAX_AUTO_ANNOTATIONS = 8;

/** Guards against a second solve being started for a frame already in flight. */
const inFlight = new Set<number>();

export const isSolving = (frameId: number) => inFlight.has(frameId);

async function setStatus(
  frameId: number,
  patch: Partial<typeof plateSolves.$inferInsert>,
): Promise<void> {
  const existing = await db
    .select({ id: plateSolves.id })
    .from(plateSolves)
    .where(eq(plateSolves.frameId, frameId))
    .get();

  if (existing) {
    await db
      .update(plateSolves)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(plateSolves.id, existing.id));
  } else {
    await db
      .insert(plateSolves)
      .values({ frameId, ...patch, createdAt: new Date(), updatedAt: new Date() });
  }
}

export type PlacedMarker = { label: string; xPct: number; yPct: number; radiusPx: number };

/**
 * Replaces the auto-generated markers on a frame, leaving hand-authored ones
 * alone. Returns the rows actually inserted.
 */
async function writeAutoAnnotations(
  frameId: number,
  selected: PlacedMarker[],
): Promise<PlacedMarker[]> {
  await db
    .delete(annotations)
    .where(and(eq(annotations.frameId, frameId), eq(annotations.source, "auto")));

  const kept = await db
    .select({ id: annotations.id, label: annotations.label })
    .from(annotations)
    .where(eq(annotations.frameId, frameId))
    .orderBy(asc(annotations.position));

  // Reviewing a marker (saving the form) turns it from auto into manual, so a
  // later re-run would otherwise re-add it alongside itself.
  const keptLabels = new Set(kept.map((k) => k.label.trim().toLowerCase()));
  const toInsert = selected.filter((a) => !keptLabels.has(a.label.trim().toLowerCase()));

  if (toInsert.length > 0) {
    await db.insert(annotations).values(
      toInsert.map((a, i) => ({
        frameId,
        position: kept.length + i,
        label: a.label,
        xPct: a.xPct,
        yPct: a.yPct,
        radiusPx: a.radiusPx,
        source: "auto",
      })),
    );
  }

  return toInsert;
}

/**
 * Regenerates markers from a solve that already happened — no upload, no
 * re-solve, no API key needed. Use after rebuilding the catalogue.
 */
export async function reannotateFrame(frameId: number): Promise<string> {
  const solve = await getPlateSolve(frameId);
  if (!solve) return "No previous solve for this frame.";

  // Prefer the stored WCS; fall back to re-fetching it for solves recorded
  // before the WCS was kept.
  let wcs = solve.wcsJson ? (JSON.parse(solve.wcsJson) as Wcs) : null;
  if (!wcs && solve.jobId) wcs = await fetchWcs(solve.jobId);
  if (!wcs) return "No WCS available — re-run the solve.";

  if (!catalogAvailable()) return "No catalogue bundled — run npm run build:catalog.";

  const images = await db.select().from(frameImages).where(eq(frameImages.frameId, frameId));
  const candidate =
    images.find((i) => i.variant === "download" && i.format === "jpeg") ??
    images.find((i) => i.variant === "article" && i.format === "jpeg");
  if (!candidate) return "No image on this frame.";

  const frame = await db.select().from(frames).where(eq(frames.id, frameId)).get();
  const { markers, consideredCount } = markersForFrame(
    wcs,
    { width: candidate.width, height: candidate.height },
    { limit: MAX_AUTO_ANNOTATIONS, targetName: frame?.catalogId },
  );

  const inserted = await writeAutoAnnotations(frameId, markers);
  await setStatus(frameId, {
    wcsJson: JSON.stringify(wcs),
    objectsFound: consideredCount,
    annotationsWritten: inserted.length,
    message: `Re-annotated from the stored solution — ${inserted.length} of ${consideredCount} objects in field added.`,
  });

  return `${inserted.length} of ${consideredCount} objects in field written.`;
}

/**
 * Solves one frame and writes the resulting markers.
 *
 * Never throws: it is started fire-and-forget from the upload route, so every
 * outcome is recorded on the plate_solves row for the admin to read.
 */
export async function solveFrame(frameId: number): Promise<void> {
  if (inFlight.has(frameId)) return;
  inFlight.add(frameId);

  try {
    if (!isConfigured()) {
      await setStatus(frameId, {
        status: "failed",
        message: "ASTROMETRY_API_KEY is not set — see SETUP.md.",
      });
      return;
    }

    const frame = await db.select().from(frames).where(eq(frames.id, frameId)).get();
    if (!frame) return;

    const images = await db
      .select()
      .from(frameImages)
      .where(eq(frameImages.frameId, frameId));

    // Submit a downscaled derivative rather than the 7–12MB master: the solver
    // works from star positions, so the extra pixels buy nothing and cost a
    // long upload.
    const candidate =
      images.find((i) => i.variant === "download" && i.format === "jpeg") ??
      images.find((i) => i.variant === "article" && i.format === "jpeg") ??
      images.find((i) => i.variant === "viewer" && i.format === "jpeg");

    if (!candidate) {
      await setStatus(frameId, {
        status: "failed",
        message: "No image to solve — upload a master first.",
      });
      return;
    }

    await setStatus(frameId, {
      status: "solving",
      message: "Uploading to astrometry.net…",
      submissionId: "",
      jobId: "",
    });

    // Positional and scale priors, when the frame carries enough to derive them.
    const master = images.find((i) => i.variant === "master");
    const position = parseRaDec(frame.plateCoordinates);
    const radiusDeg =
      master && frame.arcsecPerPx
        ? fieldRadiusDegrees(master.width, master.height, frame.arcsecPerPx)
        : null;

    // The hint must describe the SUBMITTED image, not the master.
    const submittedScale =
      frame.arcsecPerPx && master
        ? (frame.arcsecPerPx * master.width) / candidate.width
        : undefined;

    const buffer = await fs.readFile(path.join(MEDIA_ROOT, candidate.path));
    const session = await login();
    const submissionId = await uploadImage(
      session,
      buffer,
      `${frame.slug}.jpg`,
      {
        centerRa: position?.ra,
        centerDec: position?.dec,
        // Pad the search radius so a slightly-off plate value still solves.
        radiusDeg: radiusDeg ? Math.max(1, radiusDeg * 2) : undefined,
        arcsecPerPx: submittedScale,
      },
    );

    await setStatus(frameId, {
      status: "solving",
      submissionId,
      message: position
        ? `Queued with a positional hint from the plate coordinates.`
        : `Queued (no positional hint — blind solve, this takes longer).`,
    });

    const jobId = await waitForJob(submissionId, {
      onState: (state) => {
        void setStatus(frameId, { status: "solving", jobId: "", message: `Solver: ${state}…` });
      },
    });

    const [calibration, raw, wcs] = await Promise.all([
      getCalibration(jobId),
      getAnnotations(jobId),
      fetchWcs(jobId),
    ]);

    // Prefer our own catalogue over the solver's annotation list. astrometry.net
    // annotates NGC/IC and bright stars only, so the Sharpless, LBN and LDN
    // designations these targets are usually known by never appear in it.
    const image = { width: candidate.width, height: candidate.height };
    let selected: { label: string; xPct: number; yPct: number; radiusPx: number }[];
    let consideredCount: number;
    let via: string;

    if (wcs && catalogAvailable()) {
      const found = markersForFrame(wcs, image, {
        limit: MAX_AUTO_ANNOTATIONS,
        targetName: frame.catalogId,
      });
      selected = found.markers.map(({ label, xPct, yPct, radiusPx }) => ({
        label,
        xPct,
        yPct,
        radiusPx,
      }));
      consideredCount = found.consideredCount;
      via = "catalogue";
    } else {
      const found = selectAnnotations(raw, image, MAX_AUTO_ANNOTATIONS);
      selected = found.selected;
      consideredCount = found.consideredCount;
      via = wcs ? "solver list (no catalogue bundled)" : "solver list (no WCS returned)";
    }

    const toInsert = await writeAutoAnnotations(frameId, selected);

    await setStatus(frameId, {
      status: "solved",
      jobId,
      centerRa: calibration?.ra ?? null,
      centerDec: calibration?.dec ?? null,
      radiusDeg: calibration?.radius ?? null,
      // Normalised to the MASTER's scale. The solver reports the scale of
      // whichever derivative we submitted, which is not comparable with the
      // frame's own arcsec/px and reads as a contradiction in the admin.
      pixScale:
        calibration && master
          ? (calibration.pixscale * candidate.width) / master.width
          : (calibration?.pixscale ?? null),
      orientation: calibration?.orientation ?? null,
      wcsJson: wcs ? JSON.stringify(wcs) : "",
      objectsFound: consideredCount,
      annotationsWritten: toInsert.length,
      message:
        toInsert.length > 0
          ? `Solved — ${toInsert.length} of ${consideredCount} objects in field added, via ${via}. Review them below.`
          : consideredCount > 0
            ? `Solved — all ${consideredCount} objects found are already in the list.`
            : `Solved, but no catalogued objects fell inside the frame.`,
    });
  } catch (err) {
    await setStatus(frameId, {
      status: "failed",
      message: err instanceof Error ? err.message : "Plate solve failed.",
    });
  } finally {
    inFlight.delete(frameId);
  }
}

/** Fire-and-forget entry point used by the upload route. */
export function queueSolve(frameId: number): void {
  void setStatus(frameId, {
    status: "queued",
    message: "Waiting to start…",
    objectsFound: 0,
    annotationsWritten: 0,
  }).then(() => solveFrame(frameId));
}

export async function getPlateSolve(frameId: number) {
  return db.select().from(plateSolves).where(eq(plateSolves.frameId, frameId)).get() ?? null;
}
