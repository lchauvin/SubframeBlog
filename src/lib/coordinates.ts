/**
 * Parses the free-text coordinate string authored on the spec plate
 * (e.g. "RA 02h 51m · Dec +60° 26′") into decimal degrees, so a plate solve can
 * be given a local search prior instead of hunting the whole sky.
 *
 * Deliberately forgiving about separators and units — this field is written for
 * humans, not for machines, so a failed parse is normal and simply means the
 * solve runs without a positional hint.
 */
export type SkyPosition = { ra: number; dec: number };

const num = (s: string | undefined) => (s === undefined ? 0 : Number(s));

export function parseRaDec(input: string): SkyPosition | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, " ");

  // RA: "02h 51m", "02h51m30s", "2 51 30"
  const raMatch =
    /RA[^0-9+-]*(\d{1,2})\s*h\s*(\d{1,2}(?:\.\d+)?)\s*m?\s*(?:(\d{1,2}(?:\.\d+)?)\s*s)?/i.exec(text);

  // Dec: "+60° 26′", "-16d 12' 30\"", "+60 26"
  const decMatch =
    /Dec[^0-9+-]*([+-]?\d{1,2})\s*(?:°|d|:)\s*(\d{1,2}(?:\.\d+)?)\s*(?:['′:]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?)?/i.exec(
      text,
    );

  if (!raMatch || !decMatch) return null;

  const raHours = num(raMatch[1]) + num(raMatch[2]) / 60 + num(raMatch[3]) / 3600;
  const ra = raHours * 15; // hours -> degrees

  const decSign = decMatch[1].trim().startsWith("-") ? -1 : 1;
  const dec =
    decSign *
    (Math.abs(num(decMatch[1])) + num(decMatch[2]) / 60 + num(decMatch[3]) / 3600);

  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  if (ra < 0 || ra > 360 || dec < -90 || dec > 90) return null;

  return { ra, dec };
}

/**
 * Half-diagonal of the field in degrees, from the master's pixel dimensions and
 * image scale. Used as the solver's search radius.
 */
export function fieldRadiusDegrees(
  widthPx: number,
  heightPx: number,
  arcsecPerPx: number,
): number | null {
  if (!widthPx || !heightPx || !arcsecPerPx) return null;
  const wDeg = (widthPx * arcsecPerPx) / 3600;
  const hDeg = (heightPx * arcsecPerPx) / 3600;
  return Math.hypot(wDeg, hDeg) / 2;
}
