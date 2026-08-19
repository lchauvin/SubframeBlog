/**
 * The five design frames, ported from design/Subframe.dc.html.
 *
 * PLACEHOLDER WARNING — per the README, every number, date, blurb, prose
 * paragraph, session row and rejection reason below is a plausible placeholder.
 * The only real data on the site is the gear list and the location, which live
 * in src/lib/defaults.ts. Replace these with real acquisition data before
 * launch.
 *
 * Two deliberate changes from the prototype:
 *  - `capturedOn` is a real ISO date (the prototype had only "Jul 2026"
 *    strings, which cannot sort). Each is the frame's last acquisition night
 *    within the month the prototype displayed.
 *  - Annotations are per frame. The prototype reused one global five-marker
 *    array for every image; those markers were clearly authored for WR 134
 *    (HD 191765 is WR 134's own HD number), so they are kept here only on that
 *    frame. Every other frame gets a single centre marker as a placeholder —
 *    real positions should come from a plate solve (WCS / Astrometry.net).
 */

export type SeedFilter = {
  name: string;
  subLengthSeconds: number;
  keptFrames: number;
  totalFrames: number;
  hours: number;
};

export type SeedNight = {
  nightDate: string;
  filterLabel: string;
  subLengthSeconds: number;
  kept: number;
  rejected: number;
  reason: string;
};

export type SeedAnnotation = { label: string; xPct: number; yPct: number; radiusPx: number };

export type SeedFrame = {
  slug: string;
  catalogId: string;
  commonName: string;
  sourceImage: string;
  frameNumber: string;
  revision: string;
  capturedOn: string;
  palette: string;
  totalIntegrationMinutes: number;
  metaLine: string;
  blurb: string;
  prose: string[];
  note: string;
  plate: Record<string, string>;
  filters: SeedFilter[];
  nights: SeedNight[];
  annotations: SeedAnnotation[];
};

const RGB = 60;
const NB = 300;

/** Single centre marker used where no plate solve exists yet. */
const centreMarker = (label: string): SeedAnnotation[] => [
  { label, xPct: 50, yPct: 48, radiusPx: 46 },
];

export const SEED_FRAMES: SeedFrame[] = [
  {
    slug: "sh2-114",
    catalogId: "Sh2-114",
    commonName: "The Flying Dragon",
    sourceImage: "sh2-114.jpg",
    frameNumber: "041",
    revision: "A",
    capturedOn: "2026-08-21",
    palette: "HOO",
    totalIntegrationMinutes: 20 * 60 + 30,
    metaLine: "Cygnus · emission nebula · 20h 30m",
    blurb:
      "A forgotten ribbon of hydrogen on the Cygnus border — probably an ancient supernova remnant, and faint enough to be a statistic before the fourth hour.",
    prose: [
      "A thin, forgotten ribbon of ionised hydrogen on the Cygnus–Lacerta border — most likely an old supernova remnant, and faint enough that from a Bortle 9 balcony it exists only as a statistic until about the fourth hour of narrowband data.",
      "Nine nights between the neighbours' floodlights. The filaments are so low-contrast that the usual gradient tools kept reading them as background, so the model was built on a masked copy with the nebula excluded.",
      "Stretch was deliberately conservative — two small masked increments rather than one aggressive curve — and no sharpening at all beyond a gentle unsharp pass on the brightest filament.",
    ],
    note: "Worth a second season with the L-Pro for a proper RGB star layer; the current stars are thin.",
    plate: {
      plateCatalog: "Sh2-114 · LBN 176",
      plateClass: "Emission nebula / probable SNR",
      plateConstellation: "Cygnus / Lacerta border",
      plateDistance: "Uncertain · ~2,000 ly",
      plateCoordinates: "RA 21h 22m · Dec +38° 42′",
      platePalette: "HOO, near-equal weighting",
      plateSessions: "9 nights · Aug 2026",
      plateSky: "Bortle 9 · SQM 18.0 · thin haze 3 nights",
    },
    filters: [
      { name: "Hα 3nm", subLengthSeconds: NB, keptFrames: 96, totalFrames: 108, hours: 8.0 },
      { name: "OIII 3nm", subLengthSeconds: NB, keptFrames: 72, totalFrames: 84, hours: 6.0 },
      { name: "SII 3nm", subLengthSeconds: NB, keptFrames: 60, totalFrames: 71, hours: 5.0 },
      { name: "RGB stars", subLengthSeconds: RGB, keptFrames: 90, totalFrames: 96, hours: 1.5 },
    ],
    nights: [
      { nightDate: "2026-08-02", filterLabel: "Hα", subLengthSeconds: NB, kept: 48, rejected: 6, reason: "Haze" },
      { nightDate: "2026-08-05", filterLabel: "Hα", subLengthSeconds: NB, kept: 48, rejected: 6, reason: "—" },
      { nightDate: "2026-08-09", filterLabel: "OIII", subLengthSeconds: NB, kept: 44, rejected: 4, reason: "—" },
      { nightDate: "2026-08-12", filterLabel: "OIII", subLengthSeconds: NB, kept: 28, rejected: 8, reason: "Floodlight" },
      { nightDate: "2026-08-17", filterLabel: "SII", subLengthSeconds: NB, kept: 60, rejected: 11, reason: "Cloud" },
      { nightDate: "2026-08-21", filterLabel: "RGB", subLengthSeconds: RGB, kept: 90, rejected: 6, reason: "Trailing" },
    ],
    annotations: centreMarker("Sh2-114"),
  },
  {
    slug: "ngc-6888",
    catalogId: "NGC 6888",
    commonName: "The Crescent",
    sourceImage: "ngc6888.jpg",
    frameNumber: "038",
    revision: "B",
    capturedOn: "2026-08-04",
    palette: "HOO",
    totalIntegrationMinutes: 20 * 60 + 30,
    metaLine: "Cygnus · Wolf-Rayet bubble · 20h 30m",
    blurb:
      "A dying star's own shed layers colliding with what it threw off earlier. The collision front is the crescent.",
    prose: [
      "WR 136 is a dying star throwing off its own outer layers at 1,700 km/s. The shell it has inflated over the last quarter-million years is now colliding with material it shed earlier, and that collision front is what we photograph: a crescent of doubly-ionised oxygen sheathed in hydrogen.",
      "Bortle 9 gradients are not gentle. The Hα master had a light dome across the bottom third that no polynomial model would take out without eating nebulosity, so I modelled it on a heavily blurred copy and subtracted that instead.",
      "The OIII layer was stretched harder than the Hα, then blended as a luminance-weighted screen rather than a straight HOO palette — the crescent otherwise goes the same colour as everything around it. Stars were reinserted at about 70% and desaturated a step.",
    ],
    note: "Two hours of SII is not enough to be useful here. Either commit to six or drop the filter from this target entirely.",
    plate: {
      plateCatalog: "NGC 6888 · Sh2-105 · Caldwell 27",
      plateClass: "Wolf-Rayet bubble",
      plateConstellation: "Cygnus",
      plateDistance: "5,000 light years",
      plateCoordinates: "RA 20h 12m · Dec +38° 21′",
      platePalette: "HOO, OIII screened on luminance",
      plateSessions: "9 nights · 12 Jul – 04 Aug 2026",
      plateSky: "Bortle 9 · SQM 18.3 · no Moon",
    },
    filters: [
      { name: "Hα 3nm", subLengthSeconds: NB, keptFrames: 96, totalFrames: 108, hours: 8.0 },
      { name: "OIII 3nm", subLengthSeconds: NB, keptFrames: 72, totalFrames: 84, hours: 6.0 },
      { name: "SII 3nm", subLengthSeconds: NB, keptFrames: 60, totalFrames: 71, hours: 5.0 },
      { name: "RGB stars", subLengthSeconds: RGB, keptFrames: 90, totalFrames: 96, hours: 1.5 },
    ],
    nights: [
      { nightDate: "2026-07-12", filterLabel: "Hα", subLengthSeconds: NB, kept: 24, rejected: 0, reason: "—" },
      { nightDate: "2026-07-14", filterLabel: "Hα", subLengthSeconds: NB, kept: 22, rejected: 6, reason: "Cloud" },
      { nightDate: "2026-07-18", filterLabel: "Hα", subLengthSeconds: NB, kept: 50, rejected: 6, reason: "Guiding" },
      { nightDate: "2026-07-21", filterLabel: "OIII", subLengthSeconds: NB, kept: 48, rejected: 4, reason: "—" },
      { nightDate: "2026-07-26", filterLabel: "OIII", subLengthSeconds: NB, kept: 24, rejected: 8, reason: "Floodlight" },
      { nightDate: "2026-07-29", filterLabel: "SII", subLengthSeconds: NB, kept: 60, rejected: 11, reason: "Cloud" },
      { nightDate: "2026-08-04", filterLabel: "RGB", subLengthSeconds: RGB, kept: 90, rejected: 6, reason: "Trailing" },
    ],
    annotations: centreMarker("NGC 6888"),
  },
  {
    slug: "ic-1848",
    catalogId: "IC 1848",
    commonName: "The Soul",
    sourceImage: "ic1848.jpg",
    frameNumber: "039",
    revision: "C",
    capturedOn: "2026-07-29",
    palette: "HOO",
    totalIntegrationMinutes: 18 * 60 + 5,
    metaLine: "Cassiopeia · H II region · 18h 05m",
    blurb:
      "A hundred light years of hollowed hydrogen, carved by the young cluster sitting inside it. Three of nine nights went in the bin.",
    prose: [
      "A 100-light-year hollow of ionised hydrogen in Cassiopeia, carved by the young cluster inside it. At 250mm the whole complex fits with room to spare, which is the reason this rig exists.",
      "Three of the nine nights went in the bin. Two to high cloud that the guider happily tracked straight through, one to a neighbour's motion light — those subs are still in the archive, marked, because the rejection log is part of the record.",
      "Processing kept to a short path: linear gradient removal per master, deconvolution on Hα only, an HOO blend weighted 60/40 toward hydrogen, then a soft luminance mask to stop the dust lanes going grey. Stars added last, small and cool.",
    ],
    note: "The eastern dust needs another six hours of Hα before it will take any real stretch.",
    plate: {
      plateCatalog: "IC 1848 · Sh2-199 · LBN 667",
      plateClass: "Emission nebula / H II region",
      plateConstellation: "Cassiopeia",
      plateDistance: "7,500 light years",
      plateCoordinates: "RA 02h 51m · Dec +60° 26′",
      platePalette: "HOO, hydrogen-weighted 60/40",
      plateSessions: "9 nights · 12 Jul – 04 Aug 2026",
      plateSky: "Bortle 9 · SQM 18.1 · full Moon 2 nights",
    },
    filters: [
      { name: "Hα 3nm", subLengthSeconds: NB, keptFrames: 84, totalFrames: 96, hours: 7.0 },
      { name: "OIII 3nm", subLengthSeconds: NB, keptFrames: 66, totalFrames: 78, hours: 5.5 },
      { name: "SII 3nm", subLengthSeconds: NB, keptFrames: 48, totalFrames: 60, hours: 4.0 },
      { name: "RGB stars", subLengthSeconds: RGB, keptFrames: 94, totalFrames: 100, hours: 1.58 },
    ],
    nights: [
      { nightDate: "2026-07-12", filterLabel: "Hα", subLengthSeconds: NB, kept: 24, rejected: 0, reason: "—" },
      { nightDate: "2026-07-14", filterLabel: "Hα", subLengthSeconds: NB, kept: 22, rejected: 6, reason: "Cloud" },
      { nightDate: "2026-07-18", filterLabel: "Hα", subLengthSeconds: NB, kept: 38, rejected: 6, reason: "Guiding" },
      { nightDate: "2026-07-21", filterLabel: "OIII", subLengthSeconds: NB, kept: 42, rejected: 4, reason: "—" },
      { nightDate: "2026-07-26", filterLabel: "OIII", subLengthSeconds: NB, kept: 24, rejected: 8, reason: "Floodlight" },
      { nightDate: "2026-07-29", filterLabel: "SII", subLengthSeconds: NB, kept: 48, rejected: 12, reason: "Cloud" },
      { nightDate: "2026-08-04", filterLabel: "RGB", subLengthSeconds: RGB, kept: 94, rejected: 6, reason: "Trailing" },
    ],
    annotations: centreMarker("IC 1848"),
  },
  {
    slug: "ngc-7635",
    catalogId: "NGC 7635",
    commonName: "The Bubble",
    sourceImage: "ngc7635.jpg",
    frameNumber: "036",
    revision: "B",
    capturedOn: "2025-11-11",
    palette: "SHO",
    totalIntegrationMinutes: 15 * 60 + 40,
    metaLine: "Cassiopeia · emission nebula · 15h 40m",
    blurb:
      "Ten light years of shell blown into a molecular cloud by one hot star sitting slightly off-centre.",
    prose: [
      "A ten-light-year bubble blown into a molecular cloud by one hot young star sitting slightly off-centre. Small, bright, and unforgiving about star bloat — the reason half the SII went in the bin.",
      "Short, mostly linear path: gradient model per master, star removal before any stretch, an OIII-weighted blend for the shell, then careful reinsertion at reduced brightness.",
      "No sharpening beyond a mask on the shell rim itself. At 2.39″/px there is nothing finer to recover.",
    ],
    note: "Reshoot at 0.5× binning next autumn — the shell deserves the resolution.",
    plate: {
      plateCatalog: "NGC 7635 · Sh2-162 · Caldwell 11",
      plateClass: "Emission nebula / wind bubble",
      plateConstellation: "Cassiopeia",
      plateDistance: "7,100 light years",
      plateCoordinates: "RA 23h 20m · Dec +61° 12′",
      platePalette: "SHO, modified for star colour",
      plateSessions: "7 nights · Oct – Nov 2025",
      plateSky: "Bortle 9 · SQM 18.2 · frost 2 nights",
    },
    filters: [
      { name: "Hα 3nm", subLengthSeconds: NB, keptFrames: 72, totalFrames: 80, hours: 6.0 },
      { name: "OIII 3nm", subLengthSeconds: NB, keptFrames: 54, totalFrames: 66, hours: 4.5 },
      { name: "SII 3nm", subLengthSeconds: NB, keptFrames: 42, totalFrames: 66, hours: 3.5 },
      { name: "RGB stars", subLengthSeconds: RGB, keptFrames: 96, totalFrames: 102, hours: 1.66 },
    ],
    nights: [
      { nightDate: "2025-10-09", filterLabel: "Hα", subLengthSeconds: NB, kept: 40, rejected: 4, reason: "—" },
      { nightDate: "2025-10-14", filterLabel: "Hα", subLengthSeconds: NB, kept: 32, rejected: 4, reason: "Cloud" },
      { nightDate: "2025-10-22", filterLabel: "OIII", subLengthSeconds: NB, kept: 30, rejected: 6, reason: "Frost" },
      { nightDate: "2025-10-26", filterLabel: "OIII", subLengthSeconds: NB, kept: 24, rejected: 6, reason: "Cloud" },
      { nightDate: "2025-11-03", filterLabel: "SII", subLengthSeconds: NB, kept: 42, rejected: 24, reason: "Star bloat" },
      { nightDate: "2025-11-11", filterLabel: "RGB", subLengthSeconds: RGB, kept: 96, rejected: 6, reason: "Trailing" },
    ],
    annotations: centreMarker("NGC 7635"),
  },
  {
    slug: "wr-134",
    catalogId: "WR 134",
    commonName: "Wolf-Rayet ring",
    sourceImage: "wr134.jpg",
    frameNumber: "031",
    revision: "D",
    capturedOn: "2025-09-15",
    palette: "HOO",
    totalIntegrationMinutes: 24 * 60 + 10,
    metaLine: "Cygnus · Wolf-Rayet shell · 24h 10m",
    blurb:
      "The deepest field on the site: twenty-four hours for an oxygen arc that barely clears the light dome.",
    prose: [
      "Twenty-four hours for an arc of doubly-ionised oxygen that, in any single sub, is indistinguishable from noise. This is the frame that convinced me 3nm filters were worth the money.",
      "Four nights were lost outright to wildfire smoke — transparency looked fine on the all-sky camera and the subs came out flat and brown. They are logged, marked rejected, and kept.",
      "The OIII master carried the image; Hα was used mostly as a structural layer and for the surrounding field. Stars were removed early, the arc stretched in three masked steps, and the star field reinserted cool and small.",
    ],
    note: "The best data of the year came from the two nights after rain. Watch the forecast for that pattern.",
    plate: {
      plateCatalog: "WR 134 · HD 191765",
      plateClass: "Wolf-Rayet shell nebula",
      plateConstellation: "Cygnus",
      plateDistance: "6,000 light years",
      plateCoordinates: "RA 20h 10m · Dec +36° 11′",
      platePalette: "HOO, OIII dominant",
      plateSessions: "14 nights · Aug – Sep 2025",
      plateSky: "Bortle 9 · SQM 18.1 · 4 nights lost to smoke",
    },
    filters: [
      { name: "Hα 3nm", subLengthSeconds: NB, keptFrames: 108, totalFrames: 132, hours: 9.0 },
      { name: "OIII 3nm", subLengthSeconds: NB, keptFrames: 132, totalFrames: 168, hours: 11.0 },
      { name: "SII 3nm", subLengthSeconds: NB, keptFrames: 30, totalFrames: 42, hours: 2.5 },
      { name: "RGB stars", subLengthSeconds: RGB, keptFrames: 100, totalFrames: 106, hours: 1.66 },
    ],
    nights: [
      { nightDate: "2025-08-18", filterLabel: "OIII", subLengthSeconds: NB, kept: 48, rejected: 0, reason: "—" },
      { nightDate: "2025-08-22", filterLabel: "OIII", subLengthSeconds: NB, kept: 42, rejected: 18, reason: "Smoke" },
      { nightDate: "2025-08-27", filterLabel: "OIII", subLengthSeconds: NB, kept: 42, rejected: 18, reason: "Smoke" },
      { nightDate: "2025-09-01", filterLabel: "Hα", subLengthSeconds: NB, kept: 60, rejected: 12, reason: "Cloud" },
      { nightDate: "2025-09-06", filterLabel: "Hα", subLengthSeconds: NB, kept: 48, rejected: 12, reason: "Haze" },
      { nightDate: "2025-09-11", filterLabel: "SII", subLengthSeconds: NB, kept: 30, rejected: 12, reason: "Moon" },
      { nightDate: "2025-09-15", filterLabel: "RGB", subLengthSeconds: RGB, kept: 100, rejected: 6, reason: "Trailing" },
    ],
    // The prototype's global marker array, kept on the frame it was authored for.
    annotations: [
      { label: "WR 134", xPct: 31, yPct: 44, radiusPx: 54 },
      { label: "Sh2-109", xPct: 58, yPct: 36, radiusPx: 34 },
      { label: "HD 191765", xPct: 72, yPct: 62, radiusPx: 26 },
      { label: "TYC 3149", xPct: 19, yPct: 70, radiusPx: 22 },
      { label: "LBN 251", xPct: 46, yPct: 76, radiusPx: 30 },
    ],
  },
];
