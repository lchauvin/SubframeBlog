export const FRAME_DRAFT_SCHEMA_VERSION = 2;

export type FrameDraft = {
  schemaVersion: number;
  frame: Record<string, string | number | boolean>;
  filters: Array<Record<string, string | number>>;
  nights: Array<Record<string, string | number>>;
  annotations: Array<Record<string, string | number>>;
};

function asRecords(raw: FormDataEntryValue | null): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is Record<string, unknown> => {
      return typeof row === "object" && row !== null && !Array.isArray(row);
    });
  } catch {
    return [];
  }
}

function pickScalar(row: Record<string, unknown>, key: string): string | number | undefined {
  const value = row[key];
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

export function decimalHoursToParts(hours: number): {
  integrationHours: number;
  integrationMinutes: number;
} {
  const totalMinutes = Math.max(0, Math.round(Number(hours) * 60) || 0);
  return {
    integrationHours: Math.floor(totalMinutes / 60),
    integrationMinutes: totalMinutes % 60,
  };
}

export function frameDraftFromFormData(formData: FormData): FrameDraft {
  const str = (key: string) => String(formData.get(key) ?? "");
  const int = (key: string) => {
    const value = Number(formData.get(key));
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  };

  const arcsecRaw = str("arcsecPerPx").trim();
  const arcsec = Number(arcsecRaw);

  const filters = asRecords(formData.get("filtersJson")).map((row) => {
    const hours = Number(row.hours ?? 0);
    const parts = decimalHoursToParts(Number.isFinite(hours) ? hours : 0);
    const next: Record<string, string | number> = { ...parts };
    for (const key of ["name", "subLengthSeconds", "keptFrames", "totalFrames"] as const) {
      const value = pickScalar(row, key);
      if (value !== undefined) next[key] = value;
    }
    return next;
  });

  const nights = asRecords(formData.get("nightsJson")).map((row) => {
    const next: Record<string, string | number> = {};
    for (const key of [
      "nightDate",
      "filterLabel",
      "subLengthSeconds",
      "kept",
      "rejected",
      "reason",
    ] as const) {
      const value = pickScalar(row, key);
      if (value !== undefined) next[key] = value;
    }
    return next;
  });

  const annotations = asRecords(formData.get("annotationsJson")).map((row) => {
    const next: Record<string, string | number> = {};
    for (const key of ["label", "xPct", "yPct", "radiusPx"] as const) {
      const value = pickScalar(row, key);
      if (value !== undefined) next[key] = value;
    }
    return next;
  });

  return {
    schemaVersion: FRAME_DRAFT_SCHEMA_VERSION,
    frame: {
      slug: str("slug"),
      catalogId: str("catalogId"),
      commonName: str("commonName"),
      frameNumber: str("frameNumber"),
      revision: str("revision"),
      capturedOn: str("capturedOn"),
      palette: str("palette"),
      bandwidth: str("bandwidth"),
      integrationHours: int("integrationHours"),
      integrationMinutes: int("integrationMinutes"),
      metaLine: str("metaLine"),
      blurb: str("blurb"),
      bodyMarkdown: str("bodyMarkdown"),
      note: str("note"),
      plateCatalog: str("plateCatalog"),
      plateClass: str("plateClass"),
      plateConstellation: str("plateConstellation"),
      plateDistance: str("plateDistance"),
      plateCoordinates: str("plateCoordinates"),
      platePalette: str("platePalette"),
      plateSessions: str("plateSessions"),
      plateSky: str("plateSky"),
      opticsLabel: str("opticsLabel"),
      sensorLabel: str("sensorLabel"),
      arcsecPerPx: arcsecRaw === "" || !Number.isFinite(arcsec) ? "" : arcsec,
      published: formData.get("published") === "on",
    },
    filters,
    nights,
    annotations,
  };
}

export function downloadFrameDraft(draft: FrameDraft, filename: string) {
  const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
