const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parses a YYYY-MM-DD string without dragging the local timezone into it. */
function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 2026-07-14 -> "Jul 2026" */
export function formatMonthYear(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p[1] - 1]} ${p[0]}` : "";
}

/** 2026-07-14 -> "14 Jul" */
export function formatDayMonth(iso: string): string {
  const p = parts(iso);
  return p ? `${String(p[2]).padStart(2, "0")} ${MONTHS[p[1] - 1]}` : "";
}

export function formatYear(iso: string): number | null {
  return parts(iso)?.[0] ?? null;
}

/** 1085 -> "18h 05m". Carries correctly, unlike the prototype's `hm()`. */
export function formatMinutes(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  return `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, "0")}m`;
}

/** 18.08 -> "18h 05m" */
export function formatHours(hours: number): string {
  return formatMinutes(hours * 60);
}

/** "IC 1848" -> "ic-1848" */
export function slugify(input: string): string {
  return (input ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "IC 1805" + "B" -> "ic-1805-b". Empty revision keeps the catalog slug. */
export function frameSlug(catalogId: string, revision = ""): string {
  const base = slugify(catalogId);
  const rev = slugify(revision);
  if (!base || !rev) return base;
  return `${base}-${rev}`.slice(0, 80);
}

/** Splits authored copy into paragraphs on blank lines. No HTML is interpreted. */
export function toParagraphs(markdown: string): string[] {
  return (markdown ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

export type FilterBar = {
  name: string;
  keptFrames: number;
  totalFrames: number;
  hours: number;
  rejectedHours: number;
  keptLabel: string;
  keptWidth: string;
  rejectedWidth: string;
};

/**
 * Per-filter bar geometry.
 *
 * The README's formula for rejected hours is kept verbatim:
 *   rejected = (hours / kept) * (total - kept)
 *
 * The axis max deviates deliberately. The prototype used `max(hours) * 1.12`,
 * which only spans the KEPT portion — so the longest filter's kept+rejected
 * segments summed past 100% of the track and were silently squashed by
 * flex-shrink, misdrawing that bar. Spanning `max(kept + rejected) * 1.12`
 * keeps every bar comparable within the target and always fits.
 */
export function buildFilterBars(
  filters: { name: string; keptFrames: number; totalFrames: number; hours: number }[],
): FilterBar[] {
  const rows = filters.map((f) => {
    const rejectedHours =
      f.keptFrames > 0 ? (f.hours / f.keptFrames) * Math.max(0, f.totalFrames - f.keptFrames) : 0;
    return { ...f, rejectedHours };
  });

  const axisMax = Math.max(...rows.map((r) => r.hours + r.rejectedHours), 0) * 1.12 || 1;

  return rows.map((r) => ({
    ...r,
    keptLabel: formatHours(r.hours),
    keptWidth: `${((r.hours / axisMax) * 100).toFixed(1)}%`,
    rejectedWidth: `${((r.rejectedHours / axisMax) * 100).toFixed(1)}%`,
  }));
}

export const FILTER_CHANNELS = ["Ha", "SII", "OIII", "L", "R", "G", "B", "Other"] as const;
export type FilterChannel = (typeof FILTER_CHANNELS)[number];

const CHANNEL_LABEL: Record<FilterChannel, string> = {
  Ha: "Hα",
  SII: "SII",
  OIII: "OIII",
  L: "L",
  R: "R",
  G: "G",
  B: "B",
  Other: "Other",
};

/** Maps a stored filter name ("Hα 3nm", "O3", "Lum") onto the mix channels. */
export function classifyFilterChannel(name: string): FilterChannel {
  const compact = (name ?? "")
    .replace(/[αΑ]/g, "a")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (compact.startsWith("sii") || compact.startsWith("s2")) return "SII";
  if (compact.startsWith("ha") || compact.startsWith("halpha") || compact.startsWith("hydrogen")) {
    return "Ha";
  }
  if (compact.startsWith("oiii") || compact.startsWith("o3")) return "OIII";
  if (compact === "l" || compact.startsWith("lum")) return "L";
  if (compact === "r" || compact.startsWith("red")) return "R";
  if (compact === "g" || compact.startsWith("green")) return "G";
  if (compact === "b" || compact.startsWith("blue")) return "B";
  return "Other";
}

export type ChannelMixSegment = {
  key: FilterChannel;
  label: string;
  hours: number;
  hoursLabel: string;
  percent: number;
  width: string;
  percentLabel: string;
};

/**
 * One stacked 100% bar of kept integration, grouped into Ha / SII / OIII / LRGB.
 * Channels with no time are omitted. Percentages are tenths of a percent and
 * forced to sum to 100 so the track always fills.
 */
export function buildChannelMix(
  filters: { name: string; hours: number }[],
): ChannelMixSegment[] {
  const hoursByChannel: Record<FilterChannel, number> = {
    Ha: 0,
    SII: 0,
    OIII: 0,
    L: 0,
    R: 0,
    G: 0,
    B: 0,
    Other: 0,
  };
  for (const filter of filters) {
    hoursByChannel[classifyFilterChannel(filter.name)] += Math.max(0, filter.hours);
  }

  const present = FILTER_CHANNELS.filter((key) => hoursByChannel[key] > 0);
  const total = present.reduce((sum, key) => sum + hoursByChannel[key], 0);
  if (total <= 0) return [];

  let remainingTenths = 1000;
  return present.map((key, index) => {
    const hours = hoursByChannel[key];
    const tenths =
      index === present.length - 1
        ? Math.max(0, remainingTenths)
        : Math.round((hours / total) * 1000);
    remainingTenths -= tenths;
    const percent = tenths / 10;
    return {
      key,
      label: CHANNEL_LABEL[key],
      hours,
      hoursLabel: formatHours(hours),
      percent,
      width: `${percent.toFixed(1)}%`,
      percentLabel: `${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(1)}%`,
    };
  });
}
