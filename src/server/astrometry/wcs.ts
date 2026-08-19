/**
 * Minimal FITS/WCS support: enough to turn an astrometry.net solution into
 * pixel positions for catalogue objects.
 *
 * Deliberately dependency-free and pure TypeScript. The usual tool for this is
 * astropy, but nothing here needs Python — a FITS header is 80-character ASCII
 * cards, and the TAN (gnomonic) projection is closed-form spherical trig.
 */

export type Wcs = {
  crval1: number; // reference RA, degrees
  crval2: number; // reference Dec, degrees
  crpix1: number; // reference pixel X, 1-based (FITS convention)
  crpix2: number; // reference pixel Y, 1-based
  cd11: number;
  cd12: number;
  cd21: number;
  cd22: number;
  imageWidth: number;
  imageHeight: number;
};

const DEG = Math.PI / 180;

/**
 * Parses the keywords we need out of a FITS header. Cards are fixed 80-byte
 * records of the form `KEYWORD = value / comment`.
 */
export function parseWcsHeader(text: string): Wcs | null {
  const values = new Map<string, number>();

  for (let i = 0; i + 80 <= text.length; i += 80) {
    const card = text.slice(i, i + 80);
    const key = card.slice(0, 8).trim().toUpperCase();
    if (!key || key === "END") continue;
    if (card[8] !== "=") continue;

    // Strip the trailing comment, but not inside a quoted string.
    let raw = card.slice(9);
    if (!raw.includes("'")) raw = raw.split("/")[0];
    const value = Number(raw.trim().replace(/'/g, "").trim());
    if (Number.isFinite(value)) values.set(key, value);
  }

  const need = (k: string) => values.get(k);
  const crval1 = need("CRVAL1");
  const crval2 = need("CRVAL2");
  const crpix1 = need("CRPIX1");
  const crpix2 = need("CRPIX2");
  if (
    crval1 === undefined ||
    crval2 === undefined ||
    crpix1 === undefined ||
    crpix2 === undefined
  ) {
    return null;
  }

  // astrometry.net always writes a CD matrix; fall back to CDELT+CROTA only if
  // some other producer ever supplies the header.
  let cd11 = need("CD1_1");
  let cd12 = need("CD1_2");
  let cd21 = need("CD2_1");
  let cd22 = need("CD2_2");

  if (cd11 === undefined || cd22 === undefined) {
    const cdelt1 = need("CDELT1");
    const cdelt2 = need("CDELT2");
    if (cdelt1 === undefined || cdelt2 === undefined) return null;
    const rot = (need("CROTA2") ?? 0) * DEG;
    cd11 = cdelt1 * Math.cos(rot);
    cd12 = -cdelt2 * Math.sin(rot);
    cd21 = cdelt1 * Math.sin(rot);
    cd22 = cdelt2 * Math.cos(rot);
  }

  return {
    crval1,
    crval2,
    crpix1,
    crpix2,
    cd11,
    cd12: cd12 ?? 0,
    cd21: cd21 ?? 0,
    cd22: cd22!,
    imageWidth: need("IMAGEW") ?? 0,
    imageHeight: need("IMAGEH") ?? 0,
  };
}

/**
 * Sky -> pixel, gnomonic (TAN). Returns 1-based FITS pixel coordinates.
 *
 * SIP distortion terms are ignored: for a small refractor they amount to well
 * under a pixel, and a marker circle is tens of pixels across.
 */
export function skyToPixel(
  wcs: Wcs,
  ra: number,
  dec: number,
): { x: number; y: number } | null {
  const a = ra * DEG;
  const d = dec * DEG;
  const a0 = wcs.crval1 * DEG;
  const d0 = wcs.crval2 * DEG;

  const cosD = Math.cos(d);
  const sinD = Math.sin(d);
  const cosD0 = Math.cos(d0);
  const sinD0 = Math.sin(d0);
  const cosDa = Math.cos(a - a0);

  // Denominator is the cosine of the angular distance from the tangent point;
  // <= 0 means the object is on the far hemisphere and cannot be projected.
  const denom = sinD0 * sinD + cosD0 * cosD * cosDa;
  if (denom <= 0) return null;

  const xi = (cosD * Math.sin(a - a0)) / denom / DEG;
  const eta = (cosD0 * sinD - sinD0 * cosD * cosDa) / denom / DEG;

  const det = wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21;
  if (det === 0) return null;

  const u = (wcs.cd22 * xi - wcs.cd12 * eta) / det;
  const v = (-wcs.cd21 * xi + wcs.cd11 * eta) / det;

  return { x: u + wcs.crpix1, y: v + wcs.crpix2 };
}

/** Pixel -> sky, the inverse of the above. Takes 1-based pixel coordinates. */
export function pixelToSky(wcs: Wcs, x: number, y: number): { ra: number; dec: number } {
  const u = x - wcs.crpix1;
  const v = y - wcs.crpix2;

  const xi = (wcs.cd11 * u + wcs.cd12 * v) * DEG;
  const eta = (wcs.cd21 * u + wcs.cd22 * v) * DEG;

  const d0 = wcs.crval2 * DEG;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return { ra: wcs.crval1, dec: wcs.crval2 };

  const c = Math.atan(rho);
  const dec = Math.asin(
    Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho,
  );
  const ra =
    wcs.crval1 * DEG +
    Math.atan2(
      xi * Math.sin(c),
      rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c),
    );

  return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
}

/** Angular separation between two sky positions, in degrees. */
export function angularSeparation(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number,
): number {
  const d1 = dec1 * DEG;
  const d2 = dec2 * DEG;
  const dA = (ra2 - ra1) * DEG;
  const cosSep =
    Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dA);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG;
}

/** Fetches the solved WCS header for a job. No API key required. */
export async function fetchWcs(jobId: string): Promise<Wcs | null> {
  const base = process.env.ASTROMETRY_SITE_URL || "https://nova.astrometry.net";
  const res = await fetch(`${base}/wcs_file/${jobId}`);
  if (!res.ok) return null;
  return parseWcsHeader(await res.text());
}
