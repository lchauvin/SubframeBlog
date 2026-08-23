# AstroBlog — running it

Next.js 15 (App Router) + SQLite (Drizzle) + sharp. One process, port 3003.
`README.md` is the original design handoff; `PLAN.md` is the approved build plan.

## First run

```bash
npm install
cp .env.example .env.local  # optional: add an astrometry.net key, see below
npm run db:migrate          # creates data/astroblog.db
npm run seed                # loads the 5 design frames + derivatives (~20s)
npm run admin:password      # prompts for username + password
npm run dev -- --port 3003
```

Then: <http://localhost:3003> · admin at <http://localhost:3003/admin>

There is no signup page by design. `npm run admin:password` is the only way to
create or change the account; re-running it for an existing username resets the
password and signs out every existing session. For scripted setup, set
`ASTROBLOG_ADMIN_PASSWORD` and pass `--username` (an env var rather than a flag,
so it stays out of shell history).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build and serve (Node server, admin included) |
| `npm run export` | **Builds the public site as static files into `out/` for shared hosting** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Regenerate migrations after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run seed` | **Destructive** — clears content tables and reloads the design frames |
| `npm run admin:password` | Create / reset the admin account |
| `npm run check:astrometry` | Checks the plate-solve logic that needs no API key (coordinate parsing, search hints, WCS projection, catalogue placement) |
| `npm run import:wbpp -- <input> [<input>…]` | Generate a reviewable new-frame JSON draft from WBPP logs and/or manual processing directories |
| `npm run check:wbpp` | Run the standard-library WBPP importer tests |
| `npm run build:catalog` | Rebuilds `catalog/deep-sky.json` from OpenNGC + VizieR. Only needed to refresh the data |
| `npm run solve -- <slug>` | Plate-solves one frame (`--all` for every frame) |
| `npm run solve -- --reannotate <slug>` | Regenerates markers from a solve that already happened — no upload, no API key |
| `npm run verify:deploy` | Typecheck, astrometry/runtime checks, production build and server health smoke test |

**Do not run `npm run build` while `npm run dev` is running** — they share
`.next` and the dev server will start serving pages without CSS. If that
happens, stop both, `rm -rf .next`, and restart.

## Importing a WBPP frame draft

`scripts/import-wbpp.py` reads PixInsight Weighted Batch Preprocessing logs
and/or a manual processing directory, then writes JSON shaped like the New frame
admin form. It does not change the database. Pass every log or year folder from a
split run (stars processed separately, mosaic panels, WBPP plus a manual RGB
folder, and so on); the importer merges acquired and kept counts, nights, and
diagnostics into a single draft.

The deterministic pass ignores calibration frames and `.Calibration` / `.Finished`
folders. For a WBPP log it totals acquired lights by filter and `NIGHT`, then
reads final active counts from ImageIntegration (summing the largest group per
filter in each log). For a manual folder such as
`G:\Astro\IC 1805 (Heart Nebula)\2025` it counts acquired lights from
`.SessionData/<night>/LIGHT/<filter>/` and kept frames from the last populated
pipeline stage per filter (`6. LocalNormalized` when present, otherwise
`5. Registered`, then Weighted / Corrected / Calibrated / Blinked). Empty steps
such as `3. Corrected` are skipped. Drizzle `.xdrz` sidecars, LocalNormalization
`ReferenceFrame` copies, and `MasterLight` files are not counted as subframes.
Per-night rejection rows are built when kept files can be mapped back to a
session night (including frames whose timestamp rolls past midnight). The pass
also infers the palette and, for WBPP logs, extracts solved coordinates, pixel
size and image scale.
Generated integration durations use separate integer hours/minutes fields, and
rejected night rows deliberately leave `reason` blank for manual review. The
admin per-filter editor presents one Total integration time input in `6h50`
format, converting to the database's decimal-hour column only when submitted.

Python 3.8 or newer and a local Ollama installation are sufficient; the script
has no Python package dependencies. If `OLLAMA_MODEL` is unset, the importer
uses a model already pulled in the local Ollama daemon. PowerShell example:

```powershell
npm run import:wbpp -- `
  "G:\Astro\V1769 Cyg (WR 134)\WBPP\logs\20260712173704.log" `
  --bandwidth 3nm `
  --pretty --output "wr-134-frame.json"
```

Multiple logs (narrowband plus a separate stars/RGB run, or mosaic panels):

```powershell
npm run import:wbpp -- `
  "G:\Astro\Sh2-114 (Red Dragon Nebula)\WBPP\logs\20260816203420.log" `
  "G:\Astro\Sh2-114 (Red Dragon Nebula)\Stars\WBPP\logs\20260817120000.log" `
  --bandwidth 3nm `
  --pretty --output "sh2-114-frame.json"
```

A manual processing directory (WBPP-style numbered pipeline, no log file):

```powershell
npm run import:wbpp -- `
  "G:\Astro\IC 1805 (Heart Nebula)\2025" `
  --bandwidth 3nm `
  --pretty --output "ic-1805-frame.json"
```

The target hint normally comes from the first non-generic directory (folders
such as `Stars`, `RGB`, `2025`, `WBPP`, or `panel-1` are skipped); use
`--target "WR 134"` when that folder is ambiguous. SIMBAD is queried online
to verify the canonical object, all returned aliases, object type, coordinates
and available distance measurements, which are converted to light years.
Wikidata supplies the constellation (and a fallback distance from claim P2583)
after its target coordinates are checked against SIMBAD. English Wikipedia fills
in a popular name and, when the catalogs have none, a distance from the infobox.
Ollama receives those verified facts and writes a 3–4 sentence poetic Body
for the Target & processing section. It is not trusted for constellation,
distance, or common name. Any service can fail without losing the WBPP results: the
JSON `diagnostics.warnings` array records what was skipped.

Useful controls:

- `--no-simbad` / `--no-ollama` for an acquisition-only, offline draft.
- `--bandwidth`, `--optics`, `--sensor`, `--sky`, `--frame-number` and
  `--revision` for values WBPP does not reliably contain. Optics, sensor and
  arcsec/px default to the RedCat 51 WIFD + QHY MiniCam8M (2.9 µm at 250 mm).
- `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_TIMEOUT` (120 s),
  `SIMBAD_TAP_URL`, `WIKIDATA_API_URL`, `WIKIPEDIA_API_URL` and
  `SIMBAD_TIMEOUT` (20 s) for endpoint overrides.
- Omit `--output` to print compact JSON to stdout.

Open `/admin/frames/new` or an existing frame's edit page, choose the generated
file under **Import frame draft**, and review the populated fields before saving.
Importing only changes the browser form; it does not write to SQLite. On an
existing frame the slug, publish state and uploaded images are left unchanged.
The edit page can export the current form back to the same JSON shape. The full,
potentially long SIMBAD identifier list is retained under
`diagnostics.allCatalogIdentifiers`; `frame.plateCatalog` contains a concise
selection that fits the admin field.

## Deploying to Hostinger

The primary production target is now a **Hostinger Node.js web app**. It runs the
normal Next.js server, so `/admin`, uploads, publishing and plate solving work
online without rebuilding the site. Follow `DEPLOY.md` for the complete hPanel,
persistent-storage, first-admin and verification checklist.

Production requires an absolute `ASTROBLOG_DATA_DIR` outside Hostinger's
replaceable `nodejs/` deployment directory. Runtime startup creates the data
layout, applies migrations and creates the first admin from temporary
`ASTROBLOG_ADMIN_USERNAME` / `ASTROBLOG_ADMIN_PASSWORD` environment variables.

The static export remains available as a separate fallback for hosting without
Node:

```bash
npm run dev -- --port 3003     # author frames, upload masters, solve
npm run export                 # builds out/
# upload the CONTENTS of out/ to public_html
```

`npm run export` produces `out/` with one `index.html` per route, the hashed
`_next/` assets, `media/` copied from `data/media`, and an `.htaccess` pointing
Apache at `404.html`. Masters are deliberately **not** copied — nothing links to
them and they are 7–12MB each.

How the exclusion works: a static export cannot contain route handlers,
middleware or server actions, so every route file needing a server is named
`*.node.tsx` / `*.node.ts` and dropped from `pageExtensions` when
`ASTROBLOG_EXPORT=1` (see `next.config.ts`). That is Next's own mechanism for
excluding routes, and it beats moving files around mid-build. Verified: `/admin`
returns 404 from the export, and no bundle references `better-sqlite3`,
`ASTROMETRY_API_KEY` or `password_hash`.

The `/media/...` URLs are identical in both modes — served by a route handler
under `npm run dev`, and as real files in the export — so nothing in the pages
has to change between them.

**What static export gives up.** The admin isn't reachable from the web, and
publishing a frame means `npm run export` plus an upload. Drafts can't be
previewed in the export either; only published frames are emitted.

**Keep the configured data directory backed up.** It is the only copy of the
SQLite database and masters, it is gitignored, and the export does not contain
it. `/admin/diagnostics` can download a consistent DB snapshot; media needs a
separate Hostinger/File Manager backup.

## Layout

```
app/(site)/        public pages: /, /about, /frame/[slug]
app/(fullscreen)/  /frame/[slug]/full — no header/footer, its own surface
app/admin/         login (ungated) + (dashboard) group (gated)
app/media/         streams data/media with a path-traversal guard
src/server/        db (schema, client, queries), auth, media pipeline
src/components/    shared UI; admin/ holds the row editor and uploader
data/              gitignored: astroblog.db + media/<slug>/*
```

## Things worth knowing

**Auth.** scrypt (`node:crypto`, no native module) + an httpOnly session cookie
whose SHA-256 digest is what's stored, so a database leak yields no usable
sessions. The gate is `requireAdmin()` in `src/server/auth/session.ts`, called
from the admin layout, and `getCurrentAdmin()` in every route handler. There is
deliberately no middleware: it only did a cookie-presence redirect, it cannot
exist in a static export, and every protected surface already checks for itself
— so removing it cost no protection. Login is rate-limited to 5 attempts per
15 min per username+IP, with a generic failure message.

**Images.** Uploading a master writes `master` plus `viewer` (6000px),
`article` (1600px), `thumb` (600px) in WebP + JPEG, and `download` (2048px,
JPEG only, backing the viewer's chip). Dimensions are probed per file, never
assumed. Uploads go through `app/admin/upload/route.ts`, not a server action —
masters are 7–12MB and actions cap bodies at ~1MB.

**Automatic annotation.** Set `ASTROMETRY_API_KEY` in `.env.local` (from your
nova.astrometry.net profile) and uploading a master starts a plate solve in the
background. When it lands, the deep-sky objects found in the field are written
into that frame's viewer annotations, ready to review.

- **What gets sent.** A 2048px derivative, not the master — the solver works
  from star positions, so the extra pixels only cost upload time. Submissions
  go with `publicly_visible: "n"` so they are not listed in the public gallery,
  but the file does reach a third-party server. Leave the key unset to disable
  the feature entirely; everything else works and markers can be typed by hand.
- **Hints.** The frame's plate coordinates and arcsec/px are parsed into a
  search prior (`center_ra`, `center_dec`, `radius`, `scale_est`), turning an
  all-sky search into a local one. The scale hint is rescaled for the submitted
  derivative — passing the master's arcsec/px would be wrong by ~3×.
- **Where the objects come from.** Not from astrometry.net's annotation list —
  that covers NGC/IC and bright stars only, so the Sharpless and LBN
  designations these targets are usually known by never appear in it. Instead
  the solved **WCS** is fetched (`/wcs_file/<jobid>`, no API key needed) and
  `catalog/deep-sky.json` is cone-searched and projected locally. That bundle
  holds 15,382 objects — NGC, IC, Messier, Sh2, LBN, LDN — in 604KB, read from
  disk rather than imported so it never enters a build bundle. Pure TypeScript:
  a FITS header is 80-character ASCII cards and the TAN projection is
  closed-form trigonometry, so there is no Python or astropy anywhere.
  Verified against a real solve: the centre computed from the WCS agrees with
  astrometry.net's own to 0.2 arcsec, and IC 1871 lands within 0.1% of where
  they independently placed it.
- **What is kept.** Concentric designations are clustered first and labelled
  second, so one nebula yields one marker under its best-known name — IC 1848,
  not Sh2-199 *and* LBN 667 stacked on top of it. The frame's own catalog ID
  always wins its cluster. Markers cap at 64 design px so a frame-filling
  nebula still reads as a marker rather than an outline.
- **Regenerating.** The WCS is stored on the plate_solves row, so
  `npm run solve -- --reannotate <slug>` re-places every marker offline after a
  catalogue rebuild — no upload, no API key, no re-solve.
- **Review.** Rows arrive marked `source = auto`. Saving the frame accepts them
  as yours (`manual`), and a later re-solve replaces only the still-auto rows
  and skips anything whose label you already have — so re-solving never
  duplicates a marker you kept.
- **Timing.** Solves take ~30s to a few minutes on the public queue. Submission
  and job IDs are persisted, then a small worker advances the solve in short
  polling steps. A server restart resumes queued/solving rows; opening the frame
  editor also advances a pending solve.

**Acquisition numbers.** Per-filter kept/total/hours are stored and
authoritative; the night log is optional display detail and nothing is
recomputed from it. A frame with no night rows simply hides the
frame-by-frame toggle. The six About stats are hand-edited in `/admin/site`
for the same reason. The gallery subhead *is* computed, from stored frame
totals.

## Deviations from the prototype

Recorded so they read as decisions, not drift.

1. **Frames have a real `capturedOn` date.** The prototype stored only
   `"Jul 2026"` display strings, so its gallery could not actually sort
   "newest first" as it claimed.
2. **Annotations are per frame, and derived from a real plate solve.** The
   prototype reused one hardcoded five-marker array for every image; those
   markers were authored for WR 134 (HD 191765 is its own HD number), so they
   now live only on that frame. Seeded frames carry a placeholder centre marker
   until a solve replaces it.
3. **Marker radius is resolution-independent.** `radiusPx` is authored against a
   nominal 1600px-wide image (the design's 22–54px range) and rescaled to the
   actual fit width. Taken literally as CSS pixels, the same marker would have
   enclosed a different area of sky on a different monitor.
4. **Filter-bar axis spans kept + rejected**, not kept alone. With the
   prototype's `max(hours) * 1.12` the longest bar's two segments summed past
   100% of the track and were silently squashed by flex-shrink, misdrawing it.
5. **Viewer z = 1 is a true contain-fit**, and zoom clamps to the viewer
   derivative's native resolution (~2× on a 2560px display) rather than a flat
   1–8. "Fit" is now honest and the image never magnifies past real detail.
6. **Annotation circles scale with the image; labels do not.** The circle marks
   a patch of sky so it must scale; 8px type must not.
7. **`will-change: transform` is raised per gesture, not permanently.** Held
   permanently it pinned the image to its own compositing layer, so Chrome
   scaled the existing texture on zoom instead of re-rasterising and the frame
   rendered soft until something invalidated the layer.
8. Added pinch-zoom, double-tap/click, `+` `-` `0` `Esc` keys, `cursor:grabbing`
   while dragging, pan clamping and a click-to-recentre minimap — all called for
   by the README and absent from the prototype.

## Not built

Search results (the design has no such screen — the header affordance is inert),
working pagination behind the "Load 2021–2024" placeholder, DZI tiling,
account creation / password reset / multi-user, click-to-place annotation
editing, RSS, and any phone layout beyond the reductions the README names.

Also not built, but worth knowing as a possible future step: a **local** solver.
ASTAP or a local astrometry.net install would keep images off third-party
servers and solve in seconds, but returns only a WCS — the catalogue
cone-search and RA/Dec-to-pixel projection would have to be written here. The
`plate_solves` table already stores the calibration (centre, radius, scale,
rotation) that such a step would need.

## Catalogue attribution

`catalog/deep-sky.json` is built from freely redistributable sources. These
belong in the site's colophon:

- **OpenNGC** (NGC, IC, Messier) — CC-BY-SA-4.0, github.com/mattiaverga/OpenNGC
- **Sharpless 1959** (Sh2) — VizieR VII/20, CDS Strasbourg
- **Lynds 1965** Bright Nebulae (LBN) — VizieR VII/9, CDS Strasbourg
- **Lynds 1962** Dark Nebulae (LDN) — VizieR VII/7A, CDS Strasbourg

## Before launch

Every figure, date, blurb, prose paragraph and rejection reason in the seed is a
**placeholder** — see the header of `scripts/seed-data.ts`. Only the gear list
and the Montréal / Bortle 9 location are real. Set the contact link in
`/admin/site` (the "Get in touch" and "Print enquiry" buttons currently go
nowhere), and replace the working title "Subframe" with the real site name.
