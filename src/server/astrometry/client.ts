import "server-only";

/**
 * Minimal client for the nova.astrometry.net REST API.
 * Reference: https://astrometry.net/doc/net/api.html
 *
 * Every call is a POST carrying a single form field, `request-json`, holding a
 * JSON string — including the GET-shaped status endpoints, which also accept
 * plain GET. Uploads are multipart with that same field alongside `file`.
 */

const BASE = process.env.ASTROMETRY_API_URL || "https://nova.astrometry.net/api";
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;

export const isConfigured = () => Boolean(process.env.ASTROMETRY_API_KEY);

export type Calibration = {
  ra: number;
  dec: number;
  radius: number;
  pixscale: number;
  orientation: number;
};

export type RawAnnotation = {
  type: string;
  names: string[];
  pixelx: number;
  pixely: number;
  radius: number;
};

export type UploadHints = {
  /** Field centre in decimal degrees, when we can derive it from the frame. */
  centerRa?: number;
  centerDec?: number;
  /** Search radius in degrees around that centre. */
  radiusDeg?: number;
  /**
   * Arcsec per pixel OF THE IMAGE BEING SUBMITTED — not of the master. We send
   * a downscaled derivative, so the caller must rescale before passing it here.
   */
  arcsecPerPx?: number;
};

class AstrometryError extends Error {}

async function post(path: string, payload: unknown): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ "request-json": JSON.stringify(payload) });
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new AstrometryError(`${path} returned HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new AstrometryError(`${path} returned HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function login(): Promise<string> {
  const apikey = process.env.ASTROMETRY_API_KEY;
  if (!apikey) throw new AstrometryError("ASTROMETRY_API_KEY is not set.");

  const json = await post("/login", { apikey });
  if (json.status !== "success" || typeof json.session !== "string") {
    throw new AstrometryError(
      `Login rejected: ${json.errormessage ?? json.status ?? "unknown error"}`,
    );
  }
  return json.session;
}

export async function uploadImage(
  session: string,
  file: Buffer,
  filename: string,
  hints: UploadHints,
): Promise<string> {
  const request: Record<string, unknown> = {
    session,
    // Keep the submission off the public gallery. It still reaches their
    // servers — that is inherent to using the hosted solver.
    publicly_visible: "n",
    allow_modifications: "d",
    allow_commercial_use: "d",
  };

  // Hints turn an all-sky search into a local one: much faster, and far less
  // likely to land a false solution.
  if (hints.centerRa !== undefined && hints.centerDec !== undefined) {
    request.center_ra = hints.centerRa;
    request.center_dec = hints.centerDec;
    request.radius = hints.radiusDeg ?? 5;
  }
  if (hints.arcsecPerPx) {
    request.scale_units = "arcsecperpix";
    // A RANGE, not a tight estimate. The frame's stored arcsec/px describes the
    // sensor and optics, but exports are routinely drizzled, upscaled, cropped
    // or mosaicked, so the delivered image's true scale can differ severalfold
    // — a 5983px export off a 3856px sensor is 1.55x oversampled, making the
    // real scale ~0.64x the nominal. A narrow estimate excludes the correct
    // answer and the solve fails after a long grind rather than failing fast.
    request.scale_type = "ul";
    request.scale_lower = hints.arcsecPerPx / 4;
    request.scale_upper = hints.arcsecPerPx * 2;
  }

  const form = new FormData();
  form.append("request-json", JSON.stringify(request));
  form.append("file", new Blob([new Uint8Array(file)], { type: "image/jpeg" }), filename);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new AstrometryError(`Upload returned HTTP ${res.status}`);

  const json = (await res.json()) as Record<string, unknown>;
  if (json.status !== "success" || json.subid === undefined) {
    throw new AstrometryError(`Upload rejected: ${json.errormessage ?? json.status}`);
  }
  return String(json.subid);
}

export async function getSubmission(subId: string) {
  const json = await get(`/submissions/${subId}`);
  return {
    jobs: (Array.isArray(json.jobs) ? json.jobs : []).filter(
      (j): j is number => typeof j === "number",
    ),
    processingFinished: Boolean(json.processing_finished),
    // Present and non-empty once the solver gave up on the whole submission.
    errorMessage: typeof json.error_message === "string" ? json.error_message : "",
  };
}

export async function getJobStatus(jobId: string): Promise<string> {
  const json = await get(`/jobs/${jobId}`);
  return typeof json.status === "string" ? json.status : "unknown";
}

export async function getCalibration(jobId: string): Promise<Calibration | null> {
  try {
    const json = await get(`/jobs/${jobId}/calibration/`);
    if (typeof json.ra !== "number") return null;
    return {
      ra: json.ra as number,
      dec: json.dec as number,
      radius: json.radius as number,
      pixscale: json.pixscale as number,
      orientation: json.orientation as number,
    };
  } catch {
    return null;
  }
}

export async function getAnnotations(jobId: string): Promise<RawAnnotation[]> {
  const json = await get(`/jobs/${jobId}/annotations/`);
  const list = Array.isArray(json.annotations) ? json.annotations : [];
  return list
    .filter((a): a is RawAnnotation => Boolean(a) && typeof a === "object")
    .map((a) => ({
      type: String(a.type ?? ""),
      names: Array.isArray(a.names) ? a.names.map(String) : [],
      pixelx: Number(a.pixelx),
      pixely: Number(a.pixely),
      radius: Number(a.radius),
    }))
    .filter((a) => Number.isFinite(a.pixelx) && Number.isFinite(a.pixely));
}

/**
 * Waits for a submission to produce a solved job. Polls with a gentle backoff —
 * solves typically take 30s to a few minutes on the public queue.
 */
export async function waitForJob(
  subId: string,
  opts: { timeoutMs?: number; onState?: (state: string) => void } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 12 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let delay = 5000;

  while (Date.now() < deadline) {
    const submission = await getSubmission(subId);

    if (submission.errorMessage) {
      throw new AstrometryError(submission.errorMessage);
    }

    if (submission.jobs.length > 0) {
      const jobId = String(submission.jobs[0]);
      const status = await getJobStatus(jobId);
      opts.onState?.(status);

      if (status === "success") return jobId;
      if (status === "failure") {
        throw new AstrometryError("The solver could not find a match for this image.");
      }
    } else {
      opts.onState?.("queued");
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 20000);
  }

  throw new AstrometryError(
    `Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the solver.`,
  );
}
