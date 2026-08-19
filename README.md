# Handoff: Subframe — astrophotography gallery, article & full-resolution viewer

## Overview

A personal astrophotography site: a chronological image log, a per-image article carrying the full acquisition record (equipment, filters, per-filter exposure and integration time, frames rejected at integration) and a processing write-up, and a fullscreen viewer for examining the image at full resolution with zoom, pan and an annotation overlay.

Audience is mixed by design: astrophotographers who want every number, casual visitors who want the pictures, and print/licensing enquiries.

## About the design files

Everything under `design/` is a **design reference created in HTML** — a prototype demonstrating intended look and behavior. It is not production code to lift. The task is to **recreate these designs in the target codebase's own environment** (React/Next, Vue, Astro, SvelteKit, static generator, whatever exists) using its established patterns, routing, and component conventions. If no environment exists yet, pick the appropriate framework for a mostly-static, image-heavy, content-driven site (a static site generator or Next.js with static export is a natural fit — the content is a set of image records, not an app) and implement there.

The prototype files are `.dc.html` "design component" files: a single HTML file holding a markup template plus a small JS class that supplies data and handlers. Read them as a spec for structure, styling, and behavior. `design/support.js` is the prototype runtime and has **no** production relevance. The `design/_ds/` folder is the design system these screens are built on — `_ds/industry-*/styles.css` is the real token source and IS worth porting (see Design tokens).

## Fidelity

**High fidelity.** Colors, type, spacing, and interactions are final. Recreate pixel-accurately using the tokens below. The prototype's own values are already expressed as `var(--color-*)` / `var(--font-*)` referencing `styles.css`, so porting that token sheet gets you most of the way.

## The design system: Industry

Steel-blue on a light technical ground. Its rules, which the implementation must keep:

- **Square corners everywhere.** No rounded cards, buttons, or image frames.
- **Cards and figures are line drawings** — 1px hairline border, transparent (no surface fill). The one solid object is the primary button (accent fill).
- **Registration marks.** Framed objects carry a `+` glyph at each corner, offset outside the border. In the prototype this is `.mk` + `.mk-tl/.mk-tr/.mk-bl/.mk-br`: `position:absolute; font:400 11px/1 ui-monospace; color:var(--color-accent)`, offsets `top/bottom:-6px/-5px; left/right:-5px/-5px`. Keep them on the log-row image frames, the gallery frames and the primary buttons.
- **Type:** Barlow Condensed (600) for headings, all-caps with wide letter-spacing for labels; Barlow for body copy; a monospace UI font (`ui-monospace, Menlo, monospace`) for every technical label, coordinate, filter name and number.
- **Icons:** Lucide, stroke-width 1.5. The prototype inlines two (search magnifier, chevron-left); use the Lucide package.
- **Deliberate deviation from the system:** the system says photographs get a duotone accent wash. **Astrophotos are exempt — they must render at full colour.** Only the near-black image mount (`#0c0e11`) and the hatched "rejected" gradient sit outside the token set.

## Screens / views

The prototype is a 4-screen single-page state machine (`state.screen` ∈ `gallery | article | viewer | about`, plus `state.idx` for the selected target). In production these should be real routes:

| Prototype screen | Suggested route |
| --- | --- |
| gallery | `/` |
| article | `/frame/[slug]` |
| viewer | `/frame/[slug]/full` (or a modal over the article) |
| about | `/about` |

### Global chrome

**Header** — sticky, `top:0`, `z-index:5`, height 64px, `padding:0 34px`, `background:var(--color-bg)`, `border-bottom:1px solid var(--color-divider)`, `display:flex; align-items:center; justify-content:space-between`.
- Brand (clicks → gallery): 12×12px solid `var(--color-accent)` square; "SUBFRAME" in Barlow Condensed 600, 23px, `letter-spacing:.14em`, uppercase, `var(--color-text)`; then "MTL / BORTLE 9" in mono 9.5px, `letter-spacing:.14em`, uppercase, `var(--color-neutral-600)`, `padding-top:3px`. Gap 10px.
- Nav: "THE LOG" and "ABOUT & RIG", Barlow Condensed 15px, `letter-spacing:.12em`, uppercase, gap 26px. Active item is `var(--color-text)` with a 2px `var(--color-accent)` bottom border (`padding-bottom:2px`); inactive is `var(--color-neutral-600)` with a transparent border. Then a search affordance: 1px `var(--color-divider)` box, `padding:5px 9px`, Lucide search 14px + "SEARCH" in mono 9.5px, `var(--color-neutral-600)`.
- Brand and nav are placeholders for real links; `SUBFRAME` is a working title — swap in the user's site name.

**Footer** — `border-top:1px solid var(--color-divider)`, `padding:20px 34px`, flex space-between, mono 9px `letter-spacing:.14em` uppercase `var(--color-neutral-500)`: "SUBFRAME · MONTRÉAL · BORTLE 9" / "ASTROBIN · FLICKR · RSS".

All page content is capped at `max-width:1280px; margin:0 auto`.

---

### 1. The log (gallery)

**Purpose:** browse every published frame, newest first, with enough context to decide what to open.

**Layout:** `padding:38px 40px 56px`.
- H1 "The log": Barlow Condensed 600, 46px, `line-height:1`, `var(--color-text)`, margin `0 0 4px`.
- Subhead: mono 10px, `letter-spacing:.16em`, uppercase, `var(--color-neutral-600)`, margin-bottom 32px — "Newest first · 41 frames · 612h integration · 2021–2026".
- Then one **row per target** (clickable, → article):
  - `display:grid; grid-template-columns:1fr 300px; gap:34px; align-items:start; padding-bottom:34px; margin-bottom:34px; border-bottom:1px solid var(--color-divider)`.
  - **Left (image):** `position:relative; border:1px solid var(--color-divider); padding:6px; background:#0c0e11` + four `+` registration marks. Image `width:100%; height:auto; object-fit:contain` — **the full frame must be visible, never cropped** (this was an explicit request).
  - **Right (meta column, 300px):**
    - Kicker: mono 9.5px `.16em` uppercase `var(--color-accent-700)` — "AUG 2026 · HOO".
    - H2 target id: Barlow Condensed 600, 38px, `line-height:.98`.
    - Common name: Barlow Condensed 22px, `letter-spacing:.04em`, uppercase, `var(--color-neutral-600)`, margin-bottom 14px.
    - Blurb: 15.5px, `line-height:1.58`, `var(--color-neutral-800)`, `text-wrap:pretty`, margin-bottom 16px.
    - Meta line: mono 9.5px `.1em` uppercase `var(--color-neutral-500)`, `padding-top:12px; border-top:1px solid var(--color-divider)` — "CASSIOPEIA · H II REGION · 18H 05M".
    - Secondary button "ACQUISITION & PROCESSING": 1px `var(--color-neutral-400)` border, `var(--color-text)`, Barlow Condensed 14px `.14em` uppercase, `padding:8px 16px`.
- Footer of the list: centered secondary button "LOAD 2021–2024" (Barlow Condensed 15px, `padding:10px 24px`) — pagination placeholder.

Whole row is the click target; give it `cursor:pointer` and, in production, wrap it in a real `<a>` for keyboard and middle-click.

---

### 2. Article (per-image record)

**Purpose:** the complete record for one frame — what it is, how it was acquired, what was thrown away, how it was processed.

**Layout:** `padding:22px 34px 52px`.

**Back link:** inline-flex, gap 8px, Lucide chevron-left 13px + "BACK TO THE LOG", mono 9.5px `.14em` uppercase `var(--color-neutral-600)`, margin-bottom 16px.

**The spec plate** — one outer `display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--color-neutral-400)`. Interior cells are divided by `1px var(--color-divider)` rules (right + top borders per cell), and the outer frame is the heavier `--color-neutral-400`. This drawing-title-block grammar is the identity of the page.
- Row 1: **Target** cell spanning columns 1–3 (`padding:15px 17px`) — label mono 9px `.16em` uppercase `var(--color-neutral-500)` over "IC 1848 — THE SOUL" in Barlow Condensed 600, 35px, `line-height:1`. Then **Frame / Rev** (mono 15px, e.g. "039 / C"), then **Integration** (mono 15px in `var(--color-accent-700)`, e.g. "18h 05m").
- Row 2: **the image**, spanning all 4 columns, `border-top:1px solid var(--color-neutral-400)`, `background:#0c0e11`, `padding:9px`. Image `width:100%; height:auto; object-fit:contain` — again, uncropped, full aspect ratio.
  - Bottom-left overlay chips (flex, `gap:1px`): `background:rgba(12,14,17,.72)`, `border:1px solid rgba(242,242,243,.28)`, text `var(--color-bg)`, mono 9px `.1em` uppercase, `padding:5px 9px` — "HOO · 3NM", "250MM F/4.9", "3.76µM · 3.10″/PX".
  - Bottom-right primary button "ZOOM 1:1": `background:var(--color-accent)`, `color:var(--color-bg)`, Barlow Condensed 14px `.14em` uppercase, `padding:8px 16px` → opens the viewer.
- Rows 3–4: **eight spec cells** (4 per row), `padding:12px 17px`: label mono 9px `.14em` uppercase `var(--color-neutral-500)`, value 14.5px `var(--color-text)`, `line-height:1.3`. The eight are exactly: Catalog, Class, Constellation, Distance, Coordinates, Palette, Sessions, Sky. (Earlier drafts had Apparent size, Rejected, Software and Guide RMS cells — these were removed deliberately; do not reinstate them.)

**Below the plate:** `display:grid; grid-template-columns:1fr 460px; gap:38px; padding-top:32px`.

*Left column — narrative:*
- H2 "TARGET & PROCESSING": Barlow Condensed 600, 23px, `letter-spacing:.1em`, uppercase.
- 3 paragraphs, 16px, `line-height:1.6`, `var(--color-neutral-800)`, `text-wrap:pretty`, 13px bottom margin. Processing is prose, not a numbered step list (explicit user choice).
- "Note to self" callout: `border-left:2px solid var(--color-accent); padding-left:16px`; label mono 10px `.14em` uppercase `var(--color-accent-700)`; body 15.5px `line-height:1.55`, `max-width:58ch`.

*Right column (460px) — the data:*
- Header row: "PER-FILTER INTEGRATION" (mono 9.5px `.16em` uppercase `var(--color-accent-700)`) with a toggle button on the right — 1px `var(--color-neutral-400)`, mono 9px `.12em` uppercase, `padding:5px 10px`, label toggles between "SHOW FRAME-BY-FRAME LOG" and "HIDE FRAME LOG".
- **Per-filter bars**, one per filter: `display:grid; grid-template-columns:88px 1fr 62px; align-items:center; gap:10px; margin-bottom:9px`.
  - Filter name, mono 10px `var(--color-neutral-800)` ("Hα 3nm").
  - Bar track: `display:flex; height:14px; background:var(--color-neutral-200)`. Inside: a solid `var(--color-accent)` segment whose width is `kept_hours / axis_max`, immediately followed by a **hatched** segment whose width is `rejected_hours / axis_max` — `background:repeating-linear-gradient(135deg,rgba(89,128,166,.6) 0 2px,transparent 2px 4px)`. Rejected hours are derived as `(hours/kept) * (total - kept)`. Axis max = `max(hours) * 1.12` across the target's filters, so bars are comparable within a target.
  - Total kept time, mono 10px `var(--color-text)`, right-aligned ("8h 00m").
- **Legend:** `margin-top:12px; padding-top:10px; border-top:1px solid var(--color-divider)`, two items (14×8px swatch + mono 9px `.08em` uppercase `var(--color-neutral-600)`): solid = "KEPT", hatched = "REJECTED AT INTEGRATION".
- **Expandable frame log** (visible only when toggled): full-width table, `border-collapse:collapse`, `margin-top:18px`. Header cells mono 8.5px `.12em` uppercase `var(--color-neutral-500)`, `font-weight:400`, `padding:6px 0`, `border-bottom:1px solid var(--color-neutral-400)`. Body cells mono 10px, `padding:6px 0`, `border-bottom:1px solid var(--color-divider)`. Columns: Night (left), Filter (left, `var(--color-accent-700)`), Sub (right, `var(--color-neutral-600)`), Kept (right, `var(--color-text)`), Rej. (right, `var(--color-neutral-600)`), Reason (right, 9px, `var(--color-neutral-600)`).
- **Equipment list:** label mono 9.5px `.16em` uppercase `var(--color-accent-700)`, `margin:26px 0 10px`; rows `display:grid; grid-template-columns:82px 1fr; gap:14px; padding:7px 0; border-bottom:1px solid var(--color-divider)` — key mono 9.5px `.1em` uppercase `var(--color-neutral-500)`, value 13.5px `var(--color-text)`.

**Adjacent frames:** `border-top:1px solid var(--color-divider); margin-top:40px; padding-top:24px`; label mono 9.5px `.16em` uppercase `var(--color-accent-700)`; then a 4-column grid, `gap:18px`, of clickable thumbs — 1px `var(--color-divider)` frame, `padding:4px`, `background:#0c0e11`, image `height:126px; object-fit:cover`, then id (Barlow Condensed 20px `.04em` uppercase) and meta (mono 9px `.1em` uppercase `var(--color-neutral-600)`).

---

### 3. Full-resolution viewer

**Purpose:** examine the image at full resolution; optionally see catalog annotations.

**Layout:** `position:fixed; inset:0; z-index:20; background:#0c0e11; display:flex; flex-direction:column`. Three bands:

**Top bar** — `padding:12px 20px; border-bottom:1px solid rgba(242,242,243,.14)`, flex space-between.
- Left: target id (Barlow Condensed 20px `.1em` uppercase `var(--color-bg)`) + "5983 × 3499 · 3.10″/PX · 20.9 MP" (mono 9.5px `.12em` uppercase `var(--color-neutral-600)`). Pixel dimensions should come from the real asset.
- Right, a control cluster (`gap:1px`, all controls 28px tall, 1px `rgba(242,242,243,.26)` borders, `color:var(--color-bg)`): `–` (30px wide), the zoom readout (mono 10px, `min-width:56px`, centered, no left/right border), `+` (30px), then `FIT` (resets zoom and pan), `ANNOTATIONS` (a toggle — filled `var(--color-accent)` when on, transparent when off), and `CLOSE` (returns to the article). `FIT`/`ANNOTATIONS`/`CLOSE` are Barlow Condensed 13px `.12em` uppercase, `padding:0 12px`.

**Canvas** — `flex:1; overflow:hidden; background:#000; cursor:grab; user-select:none; position:relative`.
- Image centred via an absolutely-positioned flex box; the transform is applied to a wrapper: `transform: translate(Xpx, Ypx) scale(Z); transform-origin:center center; will-change:transform`. Base image width `min(100vw,1600px)`, `height:auto`, `pointer-events:none`, `draggable=false`.
- **Zoom:** wheel (`deltaY < 0` → ×1.12, else ÷1.12; `preventDefault`), buttons ×1.35 / ÷1.35, clamped to **1–8**. On zoom, pan offsets scale by the same factor (`x *= z_new/z_old`) so the point under the cursor stays put; at z = 1 offsets reset to 0. Production should also honour pinch-zoom and double-tap on touch, and support `+`/`-`/`0`/`Esc` keys.
- **Pan:** mouse-down captures `clientX/Y`, mouse-move accumulates the delta into `x`/`y`, mouse-up/leave clears the drag. Consider clamping pan so the image can't be dragged entirely off-canvas.
- **Annotation overlay** (toggleable, on by default): absolutely-positioned markers over the image wrapper, each at a percentage `left`/`top` with `transform:translate(-50%,-50%)`, `display:flex; flex-direction:column; align-items:center; gap:3px`: a circle (`border:1px solid rgba(180,217,253,.85); border-radius:50%`, diameter per-object, 22–54px in the prototype) above a label — mono 8px `.1em` uppercase, `color:var(--color-accent-300)`, `background:rgba(12,14,17,.6)`, `padding:1px 4px`, `white-space:nowrap`. **The circle is the one intentional round shape in the system** (it marks a sky object). In production these positions should come from plate-solve metadata (WCS from the FITS header / Astrometry.net annotations), not hand-placed percentages.
- **Bottom-left chips** (`left:18px; bottom:18px`, gap 1px, `background:rgba(12,14,17,.72)`, `border:1px solid rgba(242,242,243,.24)`, mono 9px `.1em` uppercase, `padding:5px 9px`): integration + palette, then a hint chip in `var(--color-accent-400)` — "SCROLL TO ZOOM · DRAG TO PAN".
- **Minimap** (`right:18px; bottom:18px`): 150px wide, `border:1px solid rgba(242,242,243,.3)`, `padding:2px`, `background:rgba(12,14,17,.6)`; the image at `opacity:.55` with a viewport rectangle over it (`border:1px solid rgba(180,217,253,.9)`). Rect geometry: `w = min(1, viewportW / (baseW*z))`, `h = min(1, viewportH / (baseH*z))`, `left = 50% - w/2 - (panX / (baseW*z))`, `top = 50% - h/2 - (panY / (baseH*z))`, all as percentages. In production the minimap should also be click-to-recentre.

**Bottom bar** — `padding:11px 20px; border-top:1px solid rgba(242,242,243,.14)`, flex space-between: target meta line (mono 9.5px `.12em` uppercase `var(--color-neutral-600)`) and two secondary chips, "DOWNLOAD 2048PX" and "PRINT ENQUIRY" (1px `rgba(242,242,243,.26)`, mono 9px `.12em` uppercase, `padding:6px 11px`).

**Performance note (important for real implementation):** the prototype loads the same ~6000px JPEG for both the page and the viewer. In production, serve a pyramid — a web-sized JPEG/WebP for the article, and tiled zoom levels (IIIF / DZI via OpenSeadragon, or `libvips dzsave`) for the viewer. That also gives correct pinch/keyboard behavior and memory safety on mobile for free.

---

### 4. About & rig

**Purpose:** who/where/what gear; the colophon and print enquiry.

`display:grid; grid-template-columns:1fr 480px` at the 1280px cap.

*Left, `padding:40px 40px 52px`:*
- Kicker "ABOUT" (mono 10px `.16em` uppercase `var(--color-accent-700)`).
- H1 "Narrowband from / a Bortle 9 sky" (Barlow Condensed 600, 52px, `line-height:1`, explicit line break).
- Two paragraphs, 17px, `line-height:1.62`, `var(--color-neutral-800)`, `max-width:60ch`.
- **Stat grid:** `display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--color-divider)` with each cell `background:var(--color-bg); padding:15px` — the 1px gap on a tinted parent draws the rules. Value: Barlow Condensed 600, 34px, `line-height:1`, `var(--color-accent-700)`. Label: mono 9px `.14em` uppercase `var(--color-neutral-600)`. Six cells: 41 Published frames / 612h Total integration / 187 Nights out / 11% Subs rejected / 3nm Narrowband bandwidth / 9 Bortle class.
- **Current rig:** label mono 9.5px `.16em` uppercase `var(--color-accent-700)`; list with `border-top:1px solid var(--color-neutral-400)`, rows `grid-template-columns:120px 1fr; gap:16px; padding:9px 0; border-bottom:1px solid var(--color-divider)`; key mono 9.5px `.12em` uppercase `var(--color-neutral-500)`, value 14.5px `var(--color-text)`.

*Right (480px), `background:#0c0e11; padding:18px; display:flex; flex-direction:column; gap:18px`:*
- Image `flex:1; min-height:420px`, `object-fit:cover`, with a caption chip bottom-left (`background:rgba(12,14,17,.66)`, mono 9px `.1em` uppercase, `color:var(--color-accent-300)`, `padding:4px 8px`).
- Card `border:1px solid rgba(242,242,243,.2); padding:16px`: label mono 9.5px `.16em` uppercase `var(--color-accent-400)`; body 14.5px `line-height:1.5` `var(--color-neutral-300)`; primary button "GET IN TOUCH" (`background:var(--color-accent)`, `color:var(--color-bg)`, Barlow Condensed 15px `.14em` uppercase, `padding:9px 18px`).

## Interactions & behavior

| Trigger | Result |
| --- | --- |
| Click a log row | Article for that target; frame-log collapsed; scroll to top |
| Click brand or "The log" | Gallery |
| Click "About & rig" | About |
| Click "Zoom 1:1" | Viewer, zoom reset to 1 (fit), pan 0,0 |
| Viewer "Close" | Back to the article |
| Click an adjacent-frame thumb | Article for that target |
| Toggle "Show frame-by-frame log" | Reveals/hides the per-night table; label flips |
| Toggle "Annotations" | Shows/hides the overlay markers; button fills with the accent when on |
| Wheel / `+` / `–` / "Fit" in viewer | Zoom, clamped 1–8; Fit resets zoom **and** pan |
| Drag in viewer | Pan |

Interaction states, per the design system (the prototype does not fully implement these — the production build must):
- Hover: an accent tint on every interactive element; log rows should get a visible affordance (a subtle accent tint on the meta column's secondary button, or the border darkening to `--color-accent`).
- Pressed: one ramp step past base — `var(--color-accent-600)` on the light ground, `var(--color-accent-400)` on the dark viewer chrome.
- Focus: `outline:2px solid var(--color-accent); outline-offset:2px` on `:focus-visible`. Never a default browser ring.
- Disabled: 45% opacity.
- Transitions: none in the prototype; if added, keep them short and mechanical (120–160ms, ease-out). The viewer transform should not be animated during drag.

Responsive behavior is not designed. The layouts are desktop, 1280px capped. Sensible reductions: log rows stack (image over meta) below ~900px; the article's 1fr/460px split stacks with the data column after the prose; the article plate collapses from 4 columns to 2; the viewer stays fullscreen with touch gestures and a hidden minimap on small screens. Confirm with the designer before shipping a phone layout.

## State management

Prototype state (per screen, in production mostly replaced by routing):

- `screen`: `gallery | article | viewer | about` → routes.
- `idx`: selected target → route param (use a slug: `ic-1848`, `ngc-6888`).
- `expanded`: boolean, frame-log disclosure. Local, resets on target change.
- `zoom` (1–8), `x`, `y`: viewer transform. Local to the viewer; reset on open.
- `annot`: boolean, annotation overlay, default **on**. Worth persisting per user.
- `drag`: `{px, py}` or null while panning. Transient.

**Data:** each frame is one content record. Fields used by the design: `id`, `commonName`, `slug`, `image`, `frameRev`, `date`, `palette`, `totalIntegration`, `metaLine`, `blurb`, `plate[8] {label, value}`, `prose[]`, `note`, `filters[] {name, subLength, kept, total, hours}`, `sessions[] {date, filter, sub, kept, rejected, reason}`, and (for the viewer) `pixelDimensions`, `arcsecPerPx`, `annotations[] {x, y, r, label}`. Site-level: the gear list, the six About stats. This is a natural fit for markdown/MDX front-matter or a small JSON/YAML per frame — and, better, generated from the acquisition software's own logs (NINA session data / a FITS header pass) so the kept-vs-rejected numbers are never hand-typed.

The rejected-frame accounting is the site's distinguishing feature — treat it as first-class data, not a footnote.

## Design tokens

Port `design/_ds/industry-<id>/styles.css` — it is the source of truth. Values used by these screens:

**Colors**
```
--color-bg        #f2f2f3   page ground
--color-surface   #e9e9ea   tinted panel
--color-text      #1d1f20   body/heading ink
--color-accent    #5980a6   steel accent (fills, marks, rules)
--color-divider   rgba(29,31,32,.16)  hairlines
neutral-100 #f5f5f8  200 #e7e7ea  300 #d4d4d7  400 #b7b7ba  500 #98989b
        600 #7a7a7d  700 #5d5d60  800 #424244  900 #2b2b2d
accent-100  #eef6ff  200 #d6ebff  300 #b5d9fd  400 #94bce3  500 #749dc4
        600 #597ea3  700 #416180  800 #2c455d  900 #1d2d3d
```
Accent-on-ground contrast is ~3:1 — fine for chrome, icons and large type, **not** for body copy. Paragraph-size accent text uses `--color-accent-700`.

Outside the token set, deliberately: `#0c0e11` (image mount / viewer ground), `#000` (viewer canvas), the hatch `rgba(89,128,166,.6)` (= accent at 60%), and the overlay scrims `rgba(12,14,17,.6–.72)` / hairlines `rgba(242,242,243,.14–.3)` on dark chrome.

**Type**
```
--font-heading  "Barlow Condensed", system-ui, sans-serif   weight 600
--font-body     "Barlow", system-ui, sans-serif             400/500
technical labels: ui-monospace, Menlo, monospace
```
Sizes in play — display 52/46/38/35px; H2 23px `.1em` caps; body 17/16/15.5/14.5/13.5px; mono labels 10.5/10/9.5/9/8.5px with `.08–.16em` letter-spacing, uppercase. Barlow Condensed headings run `line-height:.96–1`; body copy 1.5–1.64 with `text-wrap:pretty`.

**Spacing** — `--space-1..8` = 3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2px (0.85× density). Page padding 34–40px, section gaps 26–38px, card padding 12–18px.

**Radius** — `--radius-sm/md/lg` = 2/4/7px, but **the design uses 0** everywhere except the annotation circles. Do not round.

**Shadow** — `--shadow-sm/md/lg`. The screens themselves are flat; elevation only appeared on the exploration canvas.

## Assets

- `design/img/*.jpg` — five of the user's own astrophotos (5983×3499, ~1.71:1), already watermarked: `sh2-114.jpg`, `ngc6888.jpg`, `ic1848.jpg`, `ngc7635.jpg`, `wr134.jpg`. These are the real images, not placeholders. Production needs derivatives (thumb / article / tiled zoom levels).
- Icons: Lucide (`search`, `chevron-left`), stroke-width 1.5.
- Fonts: Barlow + Barlow Condensed, imported by `styles.css` from Google Fonts (Barlow 400/500/700, Barlow Condensed 400/600). Self-host for production.
- **All copy, dates, integration figures, session logs and rejection reasons in the prototype are plausible placeholders**, apart from the gear list and location, which are real: William Optics RedCat 51 (250mm f/4.9), QHY MiniCam8M, XiMei 3nm Hα/OIII/SII + XiMei broadband, ZWO AM3, Uniguide 32mm + ASI120MM Mini, Mele Quieter 4C, Montréal (Bortle 9). Replace the numbers with real acquisition data before launch.

## Files

- `design/Subframe.dc.html` — **the design to implement.** Consolidated prototype: all four screens, working zoom/pan viewer, working disclosure, per-target data in its logic class (a good starting content model).
- `design/Astrophoto Site Mockups.dc.html` — the exploration canvas: earlier gallery and article directions, kept for context. The chosen directions are the editorial log (`2b`) and the spec-sheet article (`1d`); the rest was rejected. Do not implement from this file.
- `design/SiteNav.dc.html` — nav fragment used by the exploration canvas only.
- `design/_ds/industry-<id>/` — the design system: `styles.css` (tokens — port this), `readme.md` (the rules in the system's own words), component reference pages.
- `design/support.js` — prototype runtime. Ignore.
- `screenshots/` — reference captures of the four screens as built: `01-gallery-the-log.png`, `02-article-spec-plate.png`, `03-viewer-annotations-on.png`, `04-about-and-rig.png`.
