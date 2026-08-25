import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";

import { type SolveRef } from "../../lib/astrometry-ref";
import { fieldRadiusDegrees, parseRaDec } from "../../lib/coordinates";
import { db } from "../db/client";
import { annotations, frameImages, frames, plateSolves } from "../db/schema";
import { MEDIA_ROOT } from "../paths";
import {
  getAnnotations,
  getCalibration,
  getJobStatus,
  getSubmission,
  isConfigured,
  login,
  scaleWindow,
  uploadImage,
} from "./client";
import { selectAnnotations } from "./objects";
import { catalogAvailable, markersForFrame } from "./catalog";
import { fetchWcs, type Wcs } from "./wcs";

export const MAX_AUTO_ANNOTATIONS = 8;

/** Guards against a second solve being started for a frame already in flight. */
const inFlight = new Set<number>();
const LEASE_MS = 2 * 60 * 1000;
const JOB_DISCOVERY_GRACE_MS = 15 * 60 * 1000;

export const isSolving = (frameId: number) => inFlight.has(frameId);

export function shouldKeepWaitingForJob(
  processingFinished: boolean,
  submittedAt: Date | null,
  now = Date.now(),
): boolean {
  if (!processingFinished || !submittedAt) return true;
  return now - submittedAt.getTime() < JOB_DISCOVERY_GRACE_MS;
}

async function acquireLease(frameId: number): Promise<string | null> {
  const token = randomUUID();
  const now = new Date();
  const claimed = await db
    .update(plateSolves)
    .set({ leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(plateSolves.frameId, frameId),
        or(eq(plateSolves.status, "queued"), eq(plateSolves.status, "solving")),
        or(isNull(plateSolves.leaseExpiresAt), lt(plateSolves.leaseExpiresAt, now)),
      ),
    )
    .returning({ id: plateSolves.id });
  return claimed.length > 0 ? token : null;
}

async function releaseLease(frameId: number, token: string): Promise<void> {
  await db
    .update(plateSolves)
    .set({ leaseToken: null, leaseExpiresAt: null })
    .where(and(eq(plateSolves.frameId, frameId), eq(plateSolves.leaseToken, token)));
}

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

async function failSolve(frameId: number, message: string): Promise<void> {
  await setStatus(frameId, { status: "failed", message });
}

/**
 * A hinted attempt that the solver gave up on is re-queued once without hints,
 * rather than reported as failed.
 *
 * A wrong prior confines the search to the wrong index tiles, so the solver
 * abandons a field it would otherwise solve: a stale arcsec/px puts the true
 * scale outside the submitted window, and a mistyped plate coordinate points
 * the position search somewhere else entirely. This is exactly the difference
 * between a solve here and dropping the same image on nova.astrometry.net by
 * hand, whose upload form sends no hints at all.
 */
async function failOrRetryBlind(
  frameId: number,
  hintMode: string,
  message: string,
): Promise<void> {
  if (hintMode !== "hinted") {
    await failSolve(frameId, message);
    return;
  }
  await setStatus(frameId, {
    status: "queued",
    hintMode: "blind",
    submissionId: "",
    submittedAt: null,
    jobId: "",
    message: `${message} Retrying blind, without the position and scale hints…`,
    leaseToken: null,
    leaseExpiresAt: null,
  });
}

/** Spells out the prior that was sent, so a failed solve can be reasoned about. */
function describeHints(hasPosition: boolean, arcsecPerPx: number | undefined): string {
  const parts = [
    hasPosition ? "a position from the plate coordinates" : "no position",
  ];
  if (arcsecPerPx) {
    const { lower, upper } = scaleWindow(arcsecPerPx);
    parts.push(`a ${lower.toFixed(2)}–${upper.toFixed(2)}″/px scale window`);
  }
  return `Queued with ${parts.join(" and ")}.`;
}

async function submitFrame(frameId: number, hintMode: string): Promise<void> {
  const frame = await db.select().from(frames).where(eq(frames.id, frameId)).get();
  if (!frame) return;

  const images = await db.select().from(frameImages).where(eq(frameImages.frameId, frameId));
  // Submit a derivative rather than the 7–12MB master. Star positions retain
  // enough information at this size and the durable submission id lets a later
  // process resume polling without uploading again.
  const candidate =
    images.find((i) => i.variant === "download" && i.format === "jpeg") ??
    images.find((i) => i.variant === "article" && i.format === "jpeg") ??
    images.find((i) => i.variant === "viewer" && i.format === "jpeg");
  if (!candidate) {
    await failSolve(frameId, "No image to solve — upload a master first.");
    return;
  }

  await setStatus(frameId, {
    status: "solving",
    message: "Uploading to astrometry.net…",
    submissionId: "",
    jobId: "",
  });

  const master = images.find((i) => i.variant === "master");
  const blind = hintMode === "blind";
  const position = blind ? null : parseRaDec(frame.plateCoordinates);
  const radiusDeg =
    position && master && frame.arcsecPerPx
      ? fieldRadiusDegrees(master.width, master.height, frame.arcsecPerPx)
      : null;
  const submittedScale =
    !blind && frame.arcsecPerPx && master
      ? (frame.arcsecPerPx * master.width) / candidate.width
      : undefined;

  const buffer = await fs.readFile(path.join(MEDIA_ROOT, candidate.path));
  const session = await login();
  const submissionId = await uploadImage(session, buffer, `${frame.slug}.jpg`, {
    centerRa: position?.ra,
    centerDec: position?.dec,
    radiusDeg: radiusDeg ? Math.max(1, radiusDeg * 2) : undefined,
    arcsecPerPx: submittedScale,
  });

  // An attempt that carried no prior IS the blind attempt, so record it as one.
  // Otherwise a failure would trigger a pointless identical retry.
  const sentHints = Boolean(position) || submittedScale !== undefined;

  await setStatus(frameId, {
    status: "solving",
    submissionId,
    submittedAt: new Date(),
    jobId: "",
    hintMode: sentHints ? "hinted" : "blind",
    message: sentHints
      ? describeHints(position !== null, submittedScale)
      : "Queued as a blind solve — no hints sent. This takes longer.",
  });
}

async function completeFromJob(
  frameId: number,
  jobId: string,
  origin: "solved" | "attached" = "solved",
): Promise<void> {
  const frame = await db.select().from(frames).where(eq(frames.id, frameId)).get();
  if (!frame) return;
  const images = await db.select().from(frameImages).where(eq(frameImages.frameId, frameId));
  const candidate =
    images.find((i) => i.variant === "download" && i.format === "jpeg") ??
    images.find((i) => i.variant === "article" && i.format === "jpeg") ??
    images.find((i) => i.variant === "viewer" && i.format === "jpeg");
  if (!candidate) {
    await failSolve(frameId, "The solved image derivative is no longer available.");
    return;
  }
  const master = images.find((i) => i.variant === "master");
  const [calibration, raw, wcs] = await Promise.all([
    getCalibration(jobId),
    getAnnotations(jobId),
    fetchWcs(jobId),
  ]);

  // Marker positions come out as percentages, so the grid only has to match the
  // solved image's ASPECT — its resolution is irrelevant. Prefer the dimensions
  // the solver itself recorded, which are the only correct ones when the job
  // was solved from a file this app did not upload.
  const image =
    wcs && wcs.imageWidth > 0 && wcs.imageHeight > 0
      ? { width: wcs.imageWidth, height: wcs.imageHeight }
      : { width: candidate.width, height: candidate.height };
  let selected: PlacedMarker[];
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

  const inserted = await writeAutoAnnotations(frameId, selected);
  const lead = origin === "attached" ? `Adopted job ${jobId}` : "Solved";
  await setStatus(frameId, {
    status: "solved",
    jobId,
    centerRa: calibration?.ra ?? null,
    centerDec: calibration?.dec ?? null,
    radiusDeg: calibration?.radius ?? null,
    // pixscale describes the image the solver saw; rescale it onto the master.
    pixScale:
      calibration && master
        ? (calibration.pixscale * image.width) / master.width
        : (calibration?.pixscale ?? null),
    orientation: calibration?.orientation ?? null,
    wcsJson: wcs ? JSON.stringify(wcs) : "",
    objectsFound: consideredCount,
    annotationsWritten: inserted.length,
    message:
      inserted.length > 0
        ? `${lead} — ${inserted.length} of ${consideredCount} objects in field added, via ${via}. Review them below.`
        : consideredCount > 0
          ? `${lead} — all ${consideredCount} objects found are already in the list.`
          : `${lead}, but no catalogued objects fell inside the frame.`,
  });
}

/**
 * Advances a solve by one durable step. No request stays open while the public
 * queue works, and a process restart can continue from submissionId/jobId.
 */
export async function advanceSolve(frameId: number): Promise<void> {
  if (inFlight.has(frameId)) return;
  inFlight.add(frameId);
  let leaseToken: string | null = null;
  try {
    if (!isConfigured()) {
      await failSolve(frameId, "ASTROMETRY_API_KEY is not set — see SETUP.md.");
      return;
    }

    leaseToken = await acquireLease(frameId);
    if (!leaseToken) return;

    let solve = await getPlateSolve(frameId);
    if (!solve) return;
    if (solve.status === "queued" || (solve.status === "solving" && !solve.submissionId)) {
      await submitFrame(frameId, solve.hintMode);
      solve = await getPlateSolve(frameId);
    }
    if (!solve || solve.status !== "solving" || !solve.submissionId) return;

    let jobId = solve.jobId;
    if (!jobId) {
      const submission = await getSubmission(solve.submissionId);
      if (submission.errorMessage) {
        await failSolve(frameId, submission.errorMessage);
        return;
      }
      if (submission.jobs.length === 0) {
        if (
          shouldKeepWaitingForJob(
            submission.processingFinished,
            solve.submittedAt,
          )
        ) {
          await setStatus(frameId, {
            status: "solving",
            message: submission.processingFinished
              ? "Submission processed; waiting for the solved job to appear…"
              : "Solver: queued…",
          });
        } else {
          await failOrRetryBlind(
            frameId,
            solve.hintMode,
            "Astrometry.net did not publish a solve job within 15 minutes.",
          );
        }
        return;
      }
      jobId = String(submission.jobs[0]);
      await setStatus(frameId, { status: "solving", jobId, message: "Solver: processing…" });
    }

    const status = await getJobStatus(jobId);
    if (status === "failure") {
      await failOrRetryBlind(
        frameId,
        solve.hintMode,
        "The solver could not find a match for this image.",
      );
    } else if (status === "success") {
      await completeFromJob(frameId, jobId);
    } else {
      await setStatus(frameId, { status: "solving", jobId, message: `Solver: ${status}…` });
    }
  } catch (err) {
    const transient =
      err instanceof TypeError ||
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
    if (transient) {
      await setStatus(frameId, {
        message: `Temporary astrometry.net network error — retrying: ${
          err instanceof Error ? err.message : "request failed"
        }`,
      });
    } else {
      await failSolve(frameId, err instanceof Error ? err.message : "Plate solve failed.");
    }
  } finally {
    if (leaseToken) await releaseLease(frameId, leaseToken);
    inFlight.delete(frameId);
  }
}

/** Blocking wrapper retained for the CLI. The web app uses advanceSolve(). */
export async function solveFrame(frameId: number): Promise<void> {
  let delay = 5000;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await advanceSolve(frameId);
    const solve = await getPlateSolve(frameId);
    if (solve?.status === "solved" || solve?.status === "failed") return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.4), 20_000);
  }
  await failSolve(frameId, "Timed out after 12 minutes waiting for the solver.");
}

/** Queue entry point used by uploads and the manual retry control. */
export function queueSolve(frameId: number): void {
  void setStatus(frameId, {
    status: "queued",
    hintMode: "hinted",
    submissionId: "",
    submittedAt: null,
    jobId: "",
    message: "Waiting to start…",
    objectsFound: 0,
    annotationsWritten: 0,
    leaseToken: null,
    leaseExpiresAt: null,
  }).then(() => advanceSolve(frameId));
}

/**
 * Manual retry can recover submissions failed by the former eager empty-jobs
 * check without uploading the same image again.
 */
export async function retrySolve(frameId: number): Promise<void> {
  const existing = await getPlateSolve(frameId);
  if (
    existing?.status === "failed" &&
    existing.submissionId &&
    !existing.jobId &&
    existing.message === "Astrometry.net finished without creating a solve job."
  ) {
    await setStatus(frameId, {
      status: "solving",
      submittedAt: new Date(),
      message: "Resuming the existing Astrometry.net submission…",
      leaseToken: null,
      leaseExpiresAt: null,
    });
    void advanceSolve(frameId);
    return;
  }
  queueSolve(frameId);
}

/**
 * Adopts a solution from a job solved outside this app — the escape hatch for
 * a frame the hosted solver will not solve from our derivative, but does solve
 * from the full-size export uploaded to nova.astrometry.net by hand.
 *
 * Needs no API key: calibration, annotations and the WCS header are all public
 * reads once a job exists.
 */
export async function attachSolve(frameId: number, ref: SolveRef): Promise<void> {
  if (inFlight.has(frameId)) {
    throw new Error("A solve is already running for this frame — wait for it to finish.");
  }
  inFlight.add(frameId);
  try {
    let jobId = ref.id;
    let submissionId = "";

    if (ref.kind === "submission") {
      submissionId = ref.id;
      const submission = await getSubmission(ref.id);
      if (submission.errorMessage) throw new Error(submission.errorMessage);
      if (submission.jobs.length === 0) {
        throw new Error(
          `Submission ${ref.id} has no job yet${
            submission.processingFinished ? "" : " — it is still processing"
          }.`,
        );
      }
      jobId = String(submission.jobs[0]);
    }

    const status = await getJobStatus(jobId);
    if (status !== "success") {
      throw new Error(`Job ${jobId} is "${status}", not a solved job.`);
    }

    // The frame's markers are placed from the WCS, so a job without one is of
    // no use here however well it solved.
    const wcs = await fetchWcs(jobId);
    if (!wcs) throw new Error(`Job ${jobId} did not publish a WCS header.`);

    // Positions are stored as percentages of the frame, so a job solved from a
    // differently CROPPED export would scatter markers across the wrong parts
    // of the image. Resolution may differ freely; shape may not.
    const master = await db
      .select()
      .from(frameImages)
      .where(and(eq(frameImages.frameId, frameId), eq(frameImages.variant, "master")))
      .get();
    if (master && wcs.imageWidth > 0 && wcs.imageHeight > 0) {
      const solvedAspect = wcs.imageWidth / wcs.imageHeight;
      const frameAspect = master.width / master.height;
      if (Math.abs(solvedAspect - frameAspect) / frameAspect > 0.02) {
        throw new Error(
          `That job solved a ${wcs.imageWidth}×${wcs.imageHeight} image, a different shape from this frame's ${master.width}×${master.height} master. Markers would land in the wrong places — solve the same crop instead.`,
        );
      }
    }

    await setStatus(frameId, {
      status: "solving",
      hintMode: "attached",
      submissionId,
      jobId,
      submittedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      message: `Reading the solution from job ${jobId}…`,
    });

    // A throw here would otherwise leave the row "solving" with no submission
    // id, which the next poll would try to fix by uploading the image again.
    try {
      await completeFromJob(frameId, jobId, "attached");
    } catch (err) {
      await failSolve(
        frameId,
        err instanceof Error ? err.message : "Could not read that solution.",
      );
      throw err;
    }
  } finally {
    inFlight.delete(frameId);
  }
}

export async function getPlateSolve(frameId: number) {
  return (await db.select().from(plateSolves).where(eq(plateSolves.frameId, frameId)).get()) ?? null;
}
