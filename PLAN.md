# AstroBlog — implementation plan

## Context

`D:\Python\AstroBlog` currently holds only a handoff `README.md`, an HTML design prototype under
`design/`, and four reference screenshots. There is no code and no stack chosen.

The README specs a four-screen astrophotography site — a chronological log, a per-frame article
carrying the full acquisition record, a fullscreen zoom/pan viewer, and an about/rig page — and
suggests a static generator, on the assumption that content is authored as files. That assumption no
longer holds: this build adds a **database** and a **secure admin** so frames are authored through
the browser rather than by hand-editing markdown. Everything therefore needs a server.

The intended outcome is the prototype recreated at high fidelity, backed by a real content store,
with a single-user admin that can create and edit frames, upload masters, and edit site-level copy.

### Decisions already taken

| Decision | Choice |
| --- | --- |
| Stack | Next.js 15, App Router, single process |
| Database | SQLite (file under `data/`), Drizzle ORM |
| Images | Upload master → `sharp` generates derivatives |
| Acquisition numbers | **Per-filter totals stored directly; the night log is optional detail** |

That last one is a deliberate departure from the README's "generate it from NINA logs" note. Stored
per-filter `kept` / `total` / `hours` are **authoritative**. Night rows are optional colour, not a
source of truth, and nothing recomputes over them in v1.

---

## 1. Scaffold

```
D:\Python\AstroBlog\
  app\
    layout.tsx                     # fonts, tokens, Header, Footer
    page.tsx                       # /            the log
    frame\[slug]\page.tsx          # /frame/ic-1848
    frame\[slug]\full\page.tsx     # /frame/ic-1848/full   viewer
    about\page.tsx                 # /about
    media\[...path]\route.ts       # serves data/media (see §5)
    admin\
      login\page.tsx
      layout.tsx                   # session gate
      page.tsx                     # frame list
      frames\[id]\page.tsx         # frame editor
      frames\new\page.tsx
      site\page.tsx                # site settings, stats, gear
      upload\route.ts              # multipart master upload
  src\
    server\db\{client.ts,schema.ts,queries.ts}
    server\auth\{session.ts,password.ts}
    server\media\derivatives.ts    # sharp pipeline
    components\...
    styles\tokens.css              # ported from design/_ds
  scripts\{seed.mjs,admin-password.mjs}
  data\                            # gitignored: astroblog.db, media\
  drizzle\                         # generated migrations
```

Next 15 + React 19 + TypeScript, `drizzle-orm` + `drizzle-kit` + `better-sqlite3`, `sharp`, `zod`.
No Tailwind — the design is pixel-specified in absolute px, so plain CSS Modules over the ported
token sheet tracks the spec more honestly than utility classes.

**Contingency:** if the `better-sqlite3` prebuild does not install cleanly on Node 24 / Windows,
swap to `@libsql/client` with a `file:data/astroblog.db` URL. Same Drizzle schema, one-line driver
change.

## 2. Design tokens & fonts

Port the **full** `:root` block from
`design/_ds/industry-62e589b8-7d0e-4760-9194-5da08cd55736/styles.css` into
`src/styles/tokens.css` — including the `--color-accent-2-*` ramp and `--font-heading-weight`, which
the README's token summary omits. Note the space scale really does skip `--space-5` and `--space-7`.

Fonts via `next/font/google` (Barlow 400/500/700, Barlow Condensed 400/600) — this self-hosts the
files at build time, satisfying the README's "self-host for production" without a manual font drop.

Registration marks (`.mk` + `.mk-tl/tr/bl/br`, the `+` glyphs) become one shared
`<RegistrationMarks />` component used by log-row frames, gallery frames and primary buttons.

## 3. Database schema

SQLite, WAL mode, `PRAGMA foreign_keys=ON`. Naming resolves two collisions in the prototype data:
its `sub` means *both* common name and sub-exposure length, and "sessions" would collide with auth
sessions.

**`frames`** — one row per target.
`id`, `slug` (unique, e.g. `ic-1848`), `catalog_id` ("IC 1848"), `common_name` ("The Soul"),
`frame_number`, `revision`, `captured_on` (ISO date — **new**; the prototype has only "Jul 2026"
strings and consequently cannot sort "newest first"), `palette`, `total_integration_minutes`,
`meta_line`, `blurb`, `body_markdown` (the prose paragraphs), `note`, the eight fixed plate cells as
columns (`plate_catalog`, `plate_class`, `plate_constellation`, `plate_distance`,
`plate_coordinates`, `plate_palette`, `plate_sessions`, `plate_sky`), the viewer strings
(`arcsec_per_px`, `optics_label`, `sensor_label`), `published`, `sort_index`, timestamps.

**`frame_images`** — one row per derivative: `frame_id`, `variant` (`master|viewer|article|thumb`),
`path`, `width`, `height`, `bytes`, `format`. Dimensions are probed per file, never assumed —
`ic1848.jpg` is 5983×3347 while the other four are 5983×3499, yet the prototype hardcodes
`5983 × 3499` for all five.

**`frame_filters`** — `frame_id`, `position`, `name` ("Hα 3nm"), `sub_length_seconds`, `kept_frames`,
`total_frames`, `hours`. **Stored, authoritative.** Bar geometry is computed at render from these,
using the README's own formulas: `rejected_hours = (hours / kept) * (total - kept)`, axis max =
`max(hours) * 1.12`.

**`nights`** — optional per-night detail: `frame_id`, `night_date`, `filter_label`, `sub_length`,
`kept`, `rejected`, `reason`. Purely display; nothing rolls up from it.

**`annotations`** — `frame_id`, `x_pct`, `y_pct`, `radius_px`, `label`, `position`. **Per frame**,
correcting the prototype, which reuses one hardcoded five-marker array for every image (so four of
the five targets currently show astronomically wrong labels).

**`gear_items`** — `position`, `key_label`, `value`. Site-level; renders in both the article's
equipment list and the about page.

**`site_stats`** — the six about-page cells: `position`, `value`, `label`. Hand-edited — with the
night log optional, figures like "187 nights out" have no derivable source.

**`site_settings`** — singleton: site name, tagline, nav labels, about kicker/heading/body, hero
image + caption, prints-card copy, footer strings, contact target.

**`admin_users`** — `username`, `password_hash`, `created_at`, `last_login_at`.

**`auth_sessions`** — `id` (random 256-bit token id), `user_id`, `expires_at`, `created_at`.

Migrations via `drizzle-kit generate` + `migrate`, checked into `drizzle/`.

## 4. Auth

Deliberately minimal, single-user, no registration or password-reset UI (explicitly out of scope).

- `scripts/admin-password.mjs` — CLI (`npm run admin:password`) that prompts for username +
  password and upserts the row into `admin_users`. This is the concrete answer to "credentials
  entered manually in the db" — you never hand-compute a hash.
- Hashing: **scrypt via `node:crypto`** (`randomBytes` salt, `timingSafeEqual` compare). No native
  module, no Windows build step.
- Login posts to a server action → verify → create `auth_sessions` row → set an **httpOnly,
  sameSite=lax, secure-in-production** cookie holding the session token. 30-day expiry, sliding.
- **Middleware does cookie-presence checks and redirects only.** Next middleware runs on the edge
  runtime and cannot load `better-sqlite3`; real session validation lives in a
  `requireAdmin()` helper called from the `/admin` layout and from every admin server action /
  route handler. Never trust the middleware check alone.
- Login rate limit: in-memory counter, 5 attempts / 15 min per username+IP. Generic
  "Invalid credentials" on failure — no user enumeration.
- CSRF: server actions carry Next's built-in origin check; the one hand-rolled POST
  (`admin/upload/route.ts`) validates `Origin` explicitly.

## 5. Images

`src/server/media/derivatives.ts`, on upload:

| Variant | Long edge | Format | Used by |
| --- | --- | --- | --- |
| `master` | untouched | as uploaded | archive / future re-derive |
| `viewer` | 4000px | WebP q82 + JPEG q85 | fullscreen viewer, minimap |
| `article` | 1600px | WebP + JPEG | article plate, about hero |
| `thumb` | 600px | WebP + JPEG | log rows, adjacent-frame thumbs |

Written to `data/media/<slug>/<variant>.<ext>`; dimensions probed with `sharp.metadata()` and
recorded in `frame_images`. AVIF is skipped — encoding a 6000px master to AVIF is very slow for
little gain over WebP here.

Two mechanics that need to be right:

- **Upload goes through `app/admin/upload/route.ts`, not a server action.** Masters are 7–12MB and
  server actions cap request bodies at ~1MB by default. A route handler streaming multipart avoids
  fighting `serverActions.bodySizeLimit`.
- **`data/media/` is not `public/`.** Files written at runtime aren't reliably served from `public/`.
  `app/media/[...path]/route.ts` streams from disk with long cache headers and a path-traversal
  guard (resolve, then assert the result is inside the media root).

Plain `<img>` throughout, not `next/image` — the design specifies exact frame padding and
`object-fit`, and the derivative pyramid already does the resizing job.

## 6. Public screens

Recreated to the README's spec, checked against `screenshots/*.png`.

**Global chrome** — sticky 64px header, brand → `/`, nav (`THE LOG` / `ABOUT & RIG`) with the 2px
accent underline on the active item, search affordance. Footer strings from `site_settings`. Content
capped at `max-width:1280px`. "The log" stays active on article and viewer routes, matching the
prototype.

**`/` — the log.** H1 + computed subhead (`N frames · Xh integration · YYYY–YYYY`, from stored frame
totals and `captured_on`, replacing the prototype's hardcoded "41 frames · 612h"). One row per
published frame, ordered by `captured_on` desc — real "newest first", which the prototype's data
cannot do. Each row is a real `<a>` wrapping the grid so keyboard and middle-click work.
`LOAD 2021–2024` stays a non-functional placeholder, as designed.

**`/frame/[slug]` — article.** The four-column spec plate with its drawing-title-block rules
(interior `--color-divider`, outer `--color-neutral-400`), the image band with overlay chips and the
`ZOOM 1:1` primary button, then the eight fixed spec cells. Below: prose left, data right (460px) —
per-filter bars, `KEPT` / `REJECTED AT INTEGRATION` legend, the expandable frame log, equipment list,
then the adjacent-frame strip.
Two consequences of storing totals: **the frame-log toggle is hidden entirely when a frame has no
night rows**, and one prototype bug is fixed — the longest filter's kept+rejected segments sum past
100% and get silently squashed by flex-shrink; segments will be clamped so the track reads correctly.

**`/frame/[slug]/full` — viewer.** Ports the prototype's transform logic: wheel ×1.12, buttons ×1.35,
pan by pointer delta, offsets rescaled by `z_new/z_old`, reset to 0 at z=1. **Zoom clamps to the
viewer derivative's native ratio** (~2.5× at 4000px base) rather than the README's flat 1–8, so the
image never magnifies past real detail. Adds what the prototype lacks and the README asks for:
pointer-events pinch-zoom, double-tap, `+` / `-` / `0` / `Esc` keys, `cursor:grabbing` while
dragging, and pan clamped so the frame can't be dragged off-canvas. Annotation overlay reads per-frame
rows, defaults on, persisted to `localStorage`. Minimap geometry uses the real measured canvas and
image aspect instead of the prototype's hardcoded `1600 / 760 / 1.71`. Rendered as a route so the URL
is shareable; `CLOSE` routes back to the article.

**`/about`** — 1fr/480px split, six stat cells drawn by the 1px-gap-on-tinted-parent trick, current
rig list, dark right rail with hero image + caption chip and the prints card. All copy from
`site_settings` / `site_stats` / `gear_items`.

**Interaction states** the prototype skips but the design system requires: accent hover tint on every
interactive element, `--color-accent-600` pressed on light ground / `--color-accent-400` on dark
chrome, `outline:2px solid var(--color-accent); outline-offset:2px` on `:focus-visible` only,
45% opacity disabled, 120–160ms ease-out transitions (never on the viewer transform during drag).

**Responsive:** the README says desktop-only is undesigned, so the sensible reductions it names —
log rows stack below ~900px, article's 1fr/460px stacks, plate 4→2 columns, viewer stays fullscreen
with the minimap hidden on small screens. Nothing invented beyond that.

## 7. Admin

- `/admin/login` — the only unauthenticated admin route.
- `/admin` — frame list: thumbnail, catalog id, date, palette, integration, published state; new /
  edit / delete / publish toggle.
- `/admin/frames/[id]` — one form, sectioned: identity & slug, plate cells, blurb + prose markdown,
  note, filter rows (repeatable), night rows (repeatable, optional), annotation rows (repeatable,
  numeric x/y/r/label), image upload with derivative status.
- `/admin/site` — site settings, the six stats, the gear list.
- All writes are server actions with zod validation, `requireAdmin()` at the top, and
  `revalidatePath()` on the affected public routes.
- Slug auto-derives from the catalog id (`IC 1848` → `ic-1848`) but stays editable; changing it on a
  published frame warns about the broken URL.

## 8. Dashboard registration

**After** the scaffold exists (validation fails on a `cwd` that isn't there):

1. Re-run `python D:\Python\ProjectDashboard\project_registry.py next-port` — 3003 was free at
   planning time but that is an answer, not a reservation.
2. Write `project-dashboard.json`:
   ```json
   { "name": "AstroBlog", "services": [ { "name": "Next.js Web", "type": "Next.js",
     "port": 3003, "command": "npm run dev -- --port 3003", "cwd": "." } ] }
   ```
3. Run `validate` and **read the output** — it exits non-zero on warnings too, including port
   conflicts caused by other projects.

## 9. Seed & verification

`scripts/seed.mjs` inserts the five prototype records — IC 1848, NGC 6888, Sh2-114, NGC 7635,
WR 134 — with real `captured_on` dates, the real gear list and location, and derivatives generated
from `design/img/*.jpg`. Every number it writes is flagged in a header comment as **placeholder**,
per the README: only the gear list and the Montréal / Bortle 9 location are real.

Verification, end to end:

1. `npm run db:migrate && npm run seed && npm run dev`
2. Compare each screen against its capture — `01-gallery-the-log.png`, `02-article-spec-plate.png`,
   `03-viewer-annotations-on.png`, `04-about-and-rig.png` — at 1280px wide.
3. Viewer: wheel and button zoom, drag pan, `FIT`, annotation toggle, minimap tracking, keyboard,
   `CLOSE`. Confirm zoom stops at native resolution and pan clamps.
4. `npm run admin:password`, then log in, edit a frame, upload a 12MB master, confirm derivatives
   land in `data/media/` with correct probed dimensions, and confirm the public page updates.
5. Auth: hit `/admin` logged out → redirect; tamper with the session cookie → rejected; 6 bad logins
   → rate-limited.
6. Keyboard-only pass over all four screens; confirm focus rings appear on `:focus-visible` only.
7. `python D:\Python\ProjectDashboard\project_registry.py validate` → clean.

## Explicitly out of scope

A full search results screen (the header affordance is now a live overlay panel instead — see
§Search below); DZI tiling and OpenSeadragon; working pagination behind `LOAD 2021–2024`; account
creation, password reset and multi-user roles; click-to-place annotation editing (numeric table
only); RSS; a phone layout beyond the reductions in §6, which the README says to confirm with the
designer first.

## Search

The header affordance opens an overlay panel rather than a results route, because the design has no
results screen to build and the nav box is where the affordance already sits. Matching runs in the
browser against an index serialised into every page (`listSearchDocs`): the static export has no
server to query, and at this scale the index is smaller than the request to fetch it would be. It
covers catalog id, common name, constellation, object class, palette and capture month — the fields
a frame is looked up by — and deliberately not the article prose, which would grow the payload on
every page with each new write-up. `npm run check:search` asserts the ranking.
