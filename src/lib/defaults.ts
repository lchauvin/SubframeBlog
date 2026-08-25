/**
 * Fallbacks used before `npm run seed` has run, and as the seed's own source.
 *
 * Per the README everything here is a plausible placeholder EXCEPT the gear
 * list and the location, which are real.
 */

export const DEFAULT_SITE_SETTINGS = {
  siteName: "Subframe",
  siteTagline: "MTL / Bortle 9",
  navLogLabel: "The log",
  navSkyLabel: "Sky atlas",
  navAboutLabel: "About & rig",
  logHeading: "The log",
  logPaginationLabel: "",
  skyHeading: "The sky",
  aboutKicker: "About",
  aboutHeading: "Narrowband from\na Bortle 9 sky",
  aboutBody:
    "Montréal is about as bad a place to photograph the sky as a city can be. The compensation is 3nm filters, a small fast refractor, and a lot of patience: every image here is the sum of many short nights, most of them interrupted.\n\nEach article records what was shot, what was thrown away, and why — including the frames that never made it into the stack. That log is half the point of the site.",
  aboutRigLabel: "Current rig",
  aboutHeroSlug: "",
  aboutHeroCaption: "",
  printsLabel: "Prints & licensing",
  printsBody:
    "Full-resolution TIFFs and pigment prints up to 24 × 36″. Editorial use by arrangement.",
  printsButtonLabel: "Get in touch",
  contactHref: "",
  footerLeft: "Subframe · Montréal · Bortle 9",
  footerRight: "Astrobin · Flickr · RSS",
} as const;

/** Real, per the README. */
export const DEFAULT_GEAR: { keyLabel: string; value: string }[] = [
  { keyLabel: "Optics", value: "William Optics RedCat 51 · 250mm f/4.9" },
  { keyLabel: "Camera", value: "QHY MiniCam8M · IMX585 · 2.9µm" },
  { keyLabel: "Filters", value: "XiMei 3nm Hα / OIII / SII + XiMei L-Pro" },
  { keyLabel: "Mount", value: "ZWO AM3 harmonic, no counterweight" },
  { keyLabel: "Guiding", value: "Uniguide 32mm + ZWO ASI120MM Mini" },
  { keyLabel: "Control", value: "Mele Quieter 4C · NINA + PHD2" },
  { keyLabel: "Site", value: "Montréal, QC · Bortle 9 · 45.5° N" },
];

export type GearPair = { keyLabel: string; value: string };

/** Rows that actually have both a key and a value — used on public pages. */
export function completeGearRows(rows: GearPair[] | undefined): GearPair[] {
  return (rows ?? [])
    .map(({ keyLabel, value }) => ({ keyLabel: keyLabel.trim(), value: value.trim() }))
    .filter((row) => row.keyLabel.length > 0 && row.value.length > 0);
}

/** Keep rows that have at least one field, including blanks the public page will hide. */
export function authoredGearRows(rows: GearPair[] | undefined): GearPair[] {
  return (rows ?? [])
    .map(({ keyLabel, value }) => ({ keyLabel: keyLabel.trim(), value: value.trim() }))
    .filter((row) => row.keyLabel.length > 0 || row.value.length > 0);
}

/**
 * Admin editor contents: the first list that already has rows (complete or not),
 * otherwise the built-in default rig.
 */
export function editorGearRows(...candidates: Array<GearPair[] | undefined>): GearPair[] {
  for (const list of candidates) {
    if (list && list.length > 0) {
      return list.map(({ keyLabel, value }) => ({ keyLabel, value }));
    }
  }
  return DEFAULT_GEAR.map((row) => ({ ...row }));
}

/** Public frame equipment: this frame's list if it has one, otherwise the current rig. */
export function publicGearRows(
  frameGear: GearPair[] | undefined,
  siteGear: GearPair[] | undefined,
): GearPair[] {
  if (frameGear && frameGear.length > 0) return completeGearRows(frameGear);
  return pickGearRows(siteGear);
}

/** First complete list wins; otherwise the real default rig. Used for new-frame defaults. */
export function pickGearRows(...candidates: Array<GearPair[] | undefined>): GearPair[] {
  for (const list of candidates) {
    const rows = completeGearRows(list);
    if (rows.length > 0) return rows;
  }
  return DEFAULT_GEAR.map((row) => ({ ...row }));
}

/** Placeholder figures — hand-edited in /admin/site, not derived. */
export const DEFAULT_STATS: { value: string; label: string }[] = [
  { value: "41", label: "Published frames" },
  { value: "612h", label: "Total integration" },
  { value: "187", label: "Nights out" },
  { value: "11%", label: "Subs rejected" },
  { value: "3nm", label: "Narrowband bandwidth" },
  { value: "9", label: "Bortle class" },
];

/** The eight spec-plate cells, in the order the design fixes them. */
export const PLATE_FIELDS = [
  { key: "plateCatalog", label: "Catalog" },
  { key: "plateClass", label: "Class" },
  { key: "plateConstellation", label: "Constellation" },
  { key: "plateDistance", label: "Distance" },
  { key: "plateCoordinates", label: "Coordinates" },
  { key: "platePalette", label: "Palette" },
  { key: "plateSessions", label: "Sessions" },
  { key: "plateSky", label: "Sky" },
] as const;

export type PlateFieldKey = (typeof PLATE_FIELDS)[number]["key"];
