# AstroBlog — running it

Next.js 15 (App Router) + SQLite (Drizzle) + sharp. One process, port 3003.
`README.md` is the original design handoff; `PLAN.md` is the approved build plan.

## First run

```bash
npm install
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
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Regenerate migrations after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run seed` | **Destructive** — clears content tables and reloads the design frames |
| `npm run admin:password` | Create / reset the admin account |

**Do not run `npm run build` while `npm run dev` is running** — they share
`.next` and the dev server will start serving pages without CSS. If that
happens, stop both, `rm -rf .next`, and restart.

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
sessions. `middleware.ts` only checks that a cookie exists and redirects — it
runs on the edge runtime and cannot open SQLite. The real gate is
`requireAdmin()` in `src/server/auth/session.ts`, called from the admin layout
and every action and route handler. Login is rate-limited to 5 attempts per
15 min per username+IP, with a generic failure message.

**Images.** Uploading a master writes `master` plus `viewer` (4000px),
`article` (1600px), `thumb` (600px) in WebP + JPEG, and `download` (2048px,
JPEG only, backing the viewer's chip). Dimensions are probed per file, never
assumed. Uploads go through `app/admin/upload/route.ts`, not a server action —
masters are 7–12MB and actions cap bodies at ~1MB.

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
2. **Annotations are per frame.** The prototype reused one hardcoded
   five-marker array for every image; those markers were authored for WR 134
   (HD 191765 is its own HD number), so they now live only on that frame.
   Everything else gets a placeholder centre marker — real positions should
   come from a plate solve (WCS / Astrometry.net).
3. **Filter-bar axis spans kept + rejected**, not kept alone. With the
   prototype's `max(hours) * 1.12` the longest bar's two segments summed past
   100% of the track and were silently squashed by flex-shrink, misdrawing it.
4. **Viewer z = 1 is a true contain-fit**, and zoom clamps to the viewer
   derivative's native resolution (~2× on a 2560px display) rather than a flat
   1–8. "Fit" is now honest and the image never magnifies past real detail.
5. **Annotation circles scale with the image; labels do not.** The circle marks
   a patch of sky so it must scale; 8px type must not.
6. Added pinch-zoom, double-tap/click, `+` `-` `0` `Esc` keys, `cursor:grabbing`
   while dragging, pan clamping and a click-to-recentre minimap — all called for
   by the README and absent from the prototype.

## Not built

Search results (the design has no such screen — the header affordance is inert),
working pagination behind the "Load 2021–2024" placeholder, DZI tiling,
account creation / password reset / multi-user, click-to-place annotation
editing, RSS, and any phone layout beyond the reductions the README names.

## Before launch

Every figure, date, blurb, prose paragraph and rejection reason in the seed is a
**placeholder** — see the header of `scripts/seed-data.ts`. Only the gear list
and the Montréal / Bortle 9 location are real. Set the contact link in
`/admin/site` (the "Get in touch" and "Print enquiry" buttons currently go
nowhere), and replace the working title "Subframe" with the real site name.
