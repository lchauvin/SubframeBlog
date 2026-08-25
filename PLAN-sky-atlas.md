# Sky atlas — implementation plan

## Goal

A new public page, **`/sky`**, that plots every published frame as its *actual footprint* on a
celestial chart: an RA/Dec graticule, each frame's real field-of-view quadrilateral drawn at its
solved position and rotation, clickable through to the frame's article. Hover shows a thumbnail
card. The log stays the chronological view; the atlas is the spatial one — it shows the Cygnus
region tiling in, makes gaps visible, and grows more valuable with every frame.

This plan was written against the **production database snapshot**
(`astroblog-2026-08-24T15-37-43-306Z.db`), not the local mockup DB. All counts and gotchas below
come from real data.

---

## What the production data looks like (verified)

- **16 published frames**, Sep 2024 → Aug 2026, all between Dec +30° and +62°.
- **15 of 16 have `plate_solves.status = 'solved'`** with `center_ra`, `center_dec`, `radius_deg`,
  `orientation`, `pix_scale`, and a full `wcs_json` populated. The one failure is `m-101-a` (M 101).
- M 101's `frames.plate_coordinates` is `"RA 14h 03m 12s · Dec +54° 20′56″"` — sexagesimal, and
  **already parseable by the existing `parseRaDec()` in `src/lib/coordinates.ts`** (verified against
  its regexes). No new parser is needed.
- Two targets exist as A/B revision pairs, as *separate frame rows* whose footprints nearly
  coincide on the sky: **Sh2-157** (`sh2-157`, `sh2-157-b`, centres < 0.01° apart) and **IC 63**
  (`ic-63`, `ic-63-b`, centres ~0.12° apart).
- Sky distribution: two dense clusters — Cygnus (RA ~302–320°, 6 frames) and
  Cassiopeia/Cepheus/Andromeda (RA ~341° → 44°, **wrapping through 0°**, 7 frames incl. M 31) —
  plus M 101 alone in Ursa Major.
- `catalog/deep-sky.json` holds ~15k deep-sky objects as `[name, raDeg, decDeg, majorAxisArcmin,
  type]` (OpenNGC + Sharpless + LBN + LDN). **No stars, no constellation lines** — the chart is a
  graticule + footprints + context DSOs, not a star chart.

### Gotchas (each of these will silently produce wrong output if ignored)

1. **`wcs_json` is scaled to the derivative that was solved, not the master.** e.g. frame 2's WCS
   has `imageWidth: 2048, imageHeight: 1198` while the master is 5983×3499. This is fine — the WCS
   is self-consistent with its *own* `imageWidth`/`imageHeight`, so compute footprint corners with
   `pixelToSky(wcs, …)` at the WCS's own corner pixels, never the master's dimensions.
2. **`frames.arcsec_per_px` is a display chip, not geometry.** It does not reconcile with the
   solver's `pix_scale`/`radius_deg` for any frame checked (it's hand-entered). Never derive a
   footprint size from it. Unsolved frames get a fixed-size marker instead (see §4.4).
3. **The Cassiopeia cluster wraps RA 0°.** Any naive `mean(ra)` gives a centroid near 120° —
   garbage. Centroids must be computed on 3D unit vectors (see §4.1).
4. **Chart orientation is a convention, and the naive one renders a mirrored sky.** See §4.2 for
   the required signs and a concrete assertion from real data.
5. `plate_solves.pix_scale` is master-relative while `wcs_json` is derivative-relative. Don't mix
   them; this plan only uses `wcs_json` (and `center_ra`/`center_dec` for clustering).

---

## 1. Architecture

Data flow: one pure server-side builder turns DB rows into a serialisable `AtlasData` object; a
client component renders it as SVG (client-side only for hover state — everything is prop data).

```
app\(site)\sky\page.tsx          # server component: metadata + builds AtlasData
app\(site)\sky\sky.module.css
src\server\atlas\build.ts        # queries → clustering → projection → AtlasData (pure, testable)
src\server\atlas\project.ts      # synthetic panel WCS helpers (thin layer over astrometry/wcs.ts)
src\components\AtlasChart.tsx    # "use client": SVG panel + hover card
src\components\AtlasChart.module.css
src\server\db\queries.ts         # + listAtlasFrames()
src\components\Header.tsx        # + third nav link
src\server\db\schema.ts          # + site_settings columns (§6) → drizzle migration
app\admin\(dashboard)\site\SiteForm.tsx  # + the two new label fields
```

Follow existing conventions exactly: CSS Modules over `src/styles/tokens.css` variables, no new
dependencies, `import "server-only"` in `src/server/**`, and `await useRequestTimeRendering()` at
the top of the page (same as `app/(site)/page.tsx`) so the Node deployment reads SQLite at request
time while `ASTROBLOG_EXPORT=1` stays static.

### `listAtlasFrames()` (in `src/server/db/queries.ts`)

Published frames LEFT JOINed to `plate_solves`, carrying: `id`, `slug`, `catalogId`, `commonName`,
`capturedOn`, `palette`, `totalIntegrationMinutes`, `plateConstellation`, `plateCoordinates`,
solve `status`, `centerRa`, `centerDec`, `radiusDeg`, `wcsJson`, plus the frame's `ImageSet` (reuse
the same image-attachment pattern as `listPublishedFrames`, `queries.ts:73` — the hover card needs
the `thumb` variant via the existing `pickImage(images, "thumb")`).

### `AtlasData` shape (all serialisable — it crosses to the client component)

```ts
type AtlasData = {
  panels: AtlasPanel[];
  unplaced: AtlasFrameRef[];       // frames with no usable position at all
  frameCount: number;              // published frames total (subhead)
};
type AtlasPanel = {
  title: string;                   // "Cygnus", from the dominant plateConstellation
  widthDeg: number; heightDeg: number;   // projected extent, for the viewBox
  graticule: { ra: GridLine[]; dec: GridLine[] };  // sampled polylines + labels
  scaleBar: { x: number; y: number; lengthUnits: number; label: string }; // e.g. "2°"
  footprints: AtlasFootprint[];    // solved groups: quad corners in panel units
  pins: AtlasPin[];                // unsolved: fixed-size dashed markers
  context: AtlasContextObject[];   // faint catalog DSOs for orientation
};
type AtlasFootprint = {
  corners: [number, number][4];    // panel coordinates, closed quad
  labelAnchor: [number, number];
  frames: AtlasFrameRef[];         // ≥1; [0] is the newest (the one drawn/linked)
};
type AtlasFrameRef = {
  slug: string; catalogId: string; commonName: string; revision: string;
  capturedOn: string; palette: string; integrationLabel: string;   // "18h 05m", reuse lib/format
  thumb: VariantImages;            // from pickImage(images, "thumb")
};
```

---

## 2. Positioning fallback chain (every frame must land somewhere)

For each published frame, in order:

1. **Solved** (`status === 'solved'` and `wcsJson` parses): exact footprint quad (§4.3).
2. **`parseRaDec(frame.plateCoordinates)`** succeeds → fixed-size dashed **pin** (§4.4). This is
   the path M 101 takes in the real DB.
3. Otherwise → the frame goes into `unplaced` and renders as a plain text list ("Not yet plotted")
   under the panels, each row linking to its article. **Never silently drop a frame.** (A
   catalog-name lookup in `deep-sky.json` could be added here later; it is not needed for any
   current frame, so don't build it now.)

---

## 3. Grouping stacked revisions

Before clustering into panels, group frames that are the *same target*: *same `catalogId`* **and**
centres within 0.5° (`angularSeparation` from `src/server/astrometry/wcs.ts`). Within a group,
sort by `capturedOn` descending — **the newest frame's footprint is the one drawn and linked**; the
hover card lists every frame in the group (each row a link, labelled with revision + date). In the
real DB this collapses exactly two pairs, and the newest-by-`captured_on` rule correctly picks the
B revision in both: `sh2-157-b` (2026-08-14 > 2025-09-11) and `ic-63-b` (2026-03-04 > 2025-07-22).

The drawn footprint gets a small mono chip (e.g. `2 FRAMES`) near its label when the group has more
than one member.

---

## 4. Geometry

All spherical math already exists in `src/server/astrometry/wcs.ts` (`skyToPixel`, `pixelToSky`,
`angularSeparation`). The core trick: **each panel is itself a synthetic gnomonic "plate"** — build
a `Wcs` object for the panel and project *everything* (footprint corners, pins, context objects,
graticule samples) through the same `skyToPixel(panelWcs, ra, dec)` call. No new projection code.

### 4.1 Clustering frames into panels

Greedy union: two positioned frames join the same cluster when
`angularSeparation(a, b) < 20°` (pairwise, transitive closure — a simple union-find or repeated
merge over ≤ a few dozen frames is fine). `angularSeparation` is wrap-safe, so RA 349° and RA 14°
cluster together correctly.

**Cluster centroid — must be wrap-safe:** convert each centre to a 3D unit vector
(`x=cos d·cos a, y=cos d·sin a, z=sin d`), average the vectors, convert back with
`atan2(y̅, x̅)` / `asin(z̅/‖v̅‖)`. With the real data a naive RA mean puts the Cassiopeia panel
centre near RA 120° — nothing on the panel would project.

Panel title: the most common `plateConstellation` among members ("Cygnus", "Cassiopeia",
"Ursa Major"); fall back to the round-tripped centre coordinates if blank. Order panels by member
count descending. Real-data expectation: **3 panels — Cygnus (6 frames), Cassiopeia–Andromeda
(7 frames, incl. M 31), Ursa Major (1 frame, the M 101 pin)**.

### 4.2 The synthetic panel WCS — orientation convention

Star charts are **north-up, east-left**: RA increases to the *left*, Dec increases *upward*. SVG's
y axis grows downward. So for a panel scale of `s` degrees per panel unit:

```ts
const panelWcs: Wcs = {
  crval1: centroidRa, crval2: centroidDec,
  crpix1: 0, crpix2: 0,          // shift into the viewBox afterwards via the computed extents
  cd11: -s, cd12: 0,             // RA increases leftward  → negative
  cd21: 0,  cd22: -s,            // Dec increases upward, SVG y downward → negative
  imageWidth: 0, imageHeight: 0, // unused here
};
```

(`skyToPixel` never reads `imageWidth`/`imageHeight`; bounds come from the projected extents.)
Project all panel content, take min/max x/y, pad ~8%, and use that rectangle as the SVG `viewBox`.

**Assertion to check against the real DB before styling anything** (catches a mirrored sky, which
otherwise nobody notices until an astronomer does): in the Cygnus panel, NGC 7000 (RA 314.79°)
must render **left of** IC 5070 (RA 313.87°); in the Cassiopeia panel, IC 1805 (Dec +61.5°) must
render **above** NGC 281 (Dec +56.7°).

Pick `s` so each panel fills the content width; panels will therefore have *different* sky scales,
which is why each carries a scale bar (§5). Give the Ursa Major single-pin panel a minimum extent
(~6°) so it doesn't render as a postage stamp.

### 4.3 Footprint quads (solved frames)

Parse `wcsJson` (it is a JSON serialisation of the `Wcs` type, verified). Corners in *its own*
pixel space — `(1,1), (W,1), (W,H), (1,H)` with `W = wcs.imageWidth`, `H = wcs.imageHeight` — via
`pixelToSky`, then through `skyToPixel(panelWcs, …)`. This yields the exact rotated (and, if the
solve says so, flipped) quadrilateral; `plate_solves.orientation` is *not* needed.

### 4.4 Pins (positioned but unsolved)

A fixed-size dashed square (side ≈ 1.5° in panel units) centred on the parsed position, plus the
same label treatment as footprints. Do **not** size it from `arcsec_per_px` (gotcha #2). Visually
distinct: dashed 1px stroke in `--color-neutral-500`, no fill, small `UNSOLVED` mono chip in the
hover card.

### 4.5 Graticule

RA lines at whole hours (15°) and Dec lines every 5°, covering the panel's sky bounds (derive
bounds by inverse-projecting the viewBox corners with `pixelToSky(panelWcs, …)`, with a margin).
Each line is a polyline sampled every ~0.5° and projected — under gnomonic projection graticule
lines are curves, and sampled polylines render that correctly. Labels at the panel edges in mono:
`21H`, `+40°`. Drop a line's label if it would collide with another.

### 4.6 Context objects

From `loadCatalog()` (`src/server/astrometry/catalog.ts`): objects within the panel bounds with
`majorAxisArcmin ≥ 20`, deduplicated across catalogues by the same idea as the existing clustering
in `markersForFrame` — but keep it simple here: sort by size descending, skip any candidate within
0.4° of an already-kept one or of a frame-footprint centre, keep at most ~10 per panel. Render as
faint dashed circles (diameter = major axis, projected) with small mono labels in
`--color-neutral-500`. These give the chart its "map" feel (the Veil complex, Sadr region, M 33
near the Cassiopeia panel edge) without competing with the footprints.

---

## 5. UI spec (Industry design system)

Read `README.md` §"The design system: Industry" first. Square corners, 1px hairlines, line
drawings, mono for all technical text. Astro *photos* stay full colour (hover thumbnails); the
chart itself is monochrome + accent.

- **Page chrome:** same container as the log (`max-width:1280px`), `padding:38px 40px 56px`.
  H1 from settings (§6), Barlow Condensed 600 46px. Subhead in mono 10px uppercase
  `.16em`, `--color-neutral-600`: `16 FRAMES · 3 REGIONS · PLOTTED FROM PLATE SOLVES`.
- **Panels:** stacked vertically, each `border:1px solid var(--color-divider)` with
  `<RegistrationMarks />` at the corners (reuse the component), `background:var(--color-bg)`.
  Panel title top-left *outside* the frame: Barlow Condensed 22px uppercase; member count in mono
  beside it (`6 FRAMES`).
- **Graticule:** stroke `--color-neutral-300`, 1px, no dashes; edge labels mono 9px
  `--color-neutral-500`.
- **Scale bar:** bottom-left inside the panel, map-style: a 1px horizontal rule with end ticks and
  a mono label (`2°`). Length = a round number of degrees ≈ 20% of panel width.
- **Footprints:** stroke `--color-accent` 1px, fill `color-mix(in srgb, var(--color-accent) 8%, transparent)`.
  Hover/focus: fill 18%, stroke 1.5px. Label: `catalogId` in mono 10px uppercase
  `--color-accent-700` anchored to the quad's top edge; drop to inside placement if it would leave
  the viewBox.
- **Hover card:** absolutely positioned near the cursor (flip when near an edge), 1px
  `--color-neutral-400` border, `background:var(--color-bg)`, no shadow, square corners. Contents:
  thumbnail on the `#0c0e11` mount (like log rows, `padding:4px`), then kicker
  (`AUG 2026 · HOO` — reuse `formatMonthYear`), `catalogId` in Barlow Condensed, common name,
  integration in mono. For revision groups: one row per frame (revision letter + date), each a
  link. Card must also open on keyboard focus.
- **Interaction/a11y:** each footprint/pin is an SVG `<a href={/frame/${slug}}>` wrapping the shape
  (use Next `<Link>` only outside SVG; inside SVG a plain `<a>` is correct), with
  `aria-label={`${catalogId} — ${commonName}`}`, `tabIndex` naturally focusable, visible focus
  outline (accent). The whole chart degrades to plain navigable links with no JS beyond React
  hydration. On touch/narrow viewports skip the hover card entirely — tap navigates. Panels
  scroll horizontally inside their own container if a viewport is narrower than ~700px rather than
  squashing the chart.

---

## 6. Navigation, settings, migration

The site is strictly settings-driven for labels, so:

- `site_settings` gains two columns (defaults matter — existing rows must render sensibly):
  `nav_sky_label` TEXT NOT NULL DEFAULT `'Sky atlas'`, `sky_heading` TEXT NOT NULL DEFAULT
  `'The sky'`. Run `npm run db:generate` for the migration; migrations apply on startup via the
  existing machinery (`src/server/db/migrate.ts`).
- `src/lib/defaults.ts`: extend `DEFAULT_SITE_SETTINGS` to match.
- `Header.tsx`: third nav link between the log and about — `href="/sky"`,
  active when `pathname.startsWith("/sky")` (and exclude that case from the log link's
  active state, which currently is just `!onAbout`).
- `SiteForm.tsx` (admin → site): add the two text fields alongside the existing label fields.

## 7. Metadata

`generateMetadata` mirrors `app/(site)/page.tsx:19` — `shareMetadata({ title: settings.skyHeading,
description, images: <first positioned frame's ImageSet>, path: "/sky", origin, siteName })`.

## 8. Static export

Nothing special needed: `page.tsx` (not `.node.tsx`) is included in `ASTROBLOG_EXPORT=1` builds,
the SVG is inline, thumbnails ride the existing `/media/...` copy step, `trailingSlash` emits
`out/sky/index.html`. The only rule: **no route handlers, no server actions** for this feature.

## 9. Dev workflow — use the real database

Develop against a *copy* of the production snapshot, not the mockup, and never write to the
snapshot itself:

```powershell
New-Item -ItemType Directory -Force C:\Users\Laurent\Downloads\astroblog-atlas-dev\
Copy-Item "C:\Users\Laurent\Downloads\astroblog-2026-08-24T15-37-43-306Z.db" C:\Users\Laurent\Downloads\astroblog-atlas-dev\astroblog.db
$env:ASTROBLOG_DATA_DIR = "C:\Users\Laurent\Downloads\astroblog-atlas-dev"; npm run dev
```

(`ASTROBLOG_DATA_DIR` is already honoured by `src/server/paths.ts`.) The media files are not in
the snapshot, so hover thumbnails will 404 locally — expected; verify the card layout with the
broken-image case looking acceptable (`FrameImage` behaviour), and verify thumbnails properly in
production. **Do not overwrite `data/astroblog.db` (the mockup) and do not modify the snapshot in
`Downloads`.**

## 10. Verification (acceptance numbers are from the real snapshot)

1. `npm run typecheck` passes.
2. Against the snapshot: **3 panels** — Cygnus (6 footprints), Cassiopeia–Andromeda (7 elements:
   6 footprints + M 31, where Sh2-157 and IC 63 each render **one** footprint carrying a
   `2 FRAMES` chip), Ursa Major (1 dashed pin for M 101). Total interactive elements: **14**
   (13 footprints + 1 pin). `unplaced` list: **empty**. Every published frame reachable from the
   page exactly once — mechanically: the union of slugs across footprints' `frames[]`, pins, and
   `unplaced` equals the 16 published slugs, no duplicates.
3. Orientation assertions from §4.2 hold (NGC 7000 left of IC 5070; IC 1805 above NGC 281).
4. Stacked-revision hover cards link to *both* revisions; the drawn/linked footprint is the B
   revision for both pairs.
5. Adjacent Cygnus footprints (NGC 7000 / IC 5070) visibly share an edge region — they are
   neighbouring fields in reality; if they don't overlap/abut, the projection is wrong.
6. Keyboard: tab reaches every footprint/pin in a sensible order; Enter navigates.
7. `npm run export` succeeds; `out/sky/index.html` exists and renders (open the file through the
   preview of your choice); no route-handler references leaked in.
8. The existing suite still passes: `npm run verify:deploy`.

## Out of scope (deliberately)

- Constellation stick figures and star fields (needs a bright-star + line-pair data file; the
  catalog has neither).
- A full-sky overview projection; region panels only.
- Admin editing of atlas content (it derives entirely from existing data).
- Timeline/animation of coverage growth.
