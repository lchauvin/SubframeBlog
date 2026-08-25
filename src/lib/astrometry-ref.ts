/**
 * Parses whatever the admin pasted from nova.astrometry.net into a submission
 * or job id, so a solution obtained by hand there can be adopted here.
 *
 * The site exposes both ids in URLs the user actually sees:
 *   /status/13012345          the submission created by an upload
 *   /jobs/9876543             the job that submission produced
 *   /user_images/8765432      the results page, which is neither
 *
 * A bare number is ambiguous — the caller says which kind it is.
 */
export type SolveRef = { kind: "submission" | "job"; id: string };

export function parseSolveRef(
  input: string,
  fallbackKind: "submission" | "job" = "submission",
): SolveRef | null {
  const text = input.trim();
  if (!text) return null;

  // A URL (or any path-ish string) names its own kind.
  const path = /\/(status|submissions|jobs|job_status|api\/jobs)\/(\d+)/i.exec(text);
  if (path) {
    const kind = /^(status|submissions)$/i.test(path[1]) ? "submission" : "job";
    return { kind, id: path[2] };
  }

  // The results page carries a user_image id, which is neither of the two and
  // cannot be turned into one without scraping. Reject it explicitly.
  if (/\/user_images\/\d+/i.test(text)) return null;

  const labelled = /^(submission|sub|job)\s*[:# ]?\s*(\d+)$/i.exec(text);
  if (labelled) {
    return { kind: /^job$/i.test(labelled[1]) ? "job" : "submission", id: labelled[2] };
  }

  if (/^\d+$/.test(text)) return { kind: fallbackKind, id: text };

  return null;
}
