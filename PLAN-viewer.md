# Full-resolution viewer — implementation plan

## Goal

Make `/frame/<slug>/full` show the frame's **real pixels at true 1:1**, on any display, without a
multi-megabyte blocking download — and make the zoom readout mean what an astrophotographer expects
it to mean.

Delivered in two stages. **Stage 1** fixes the resolution and colour defects with no new
architecture (~10 lines of source plus a re-derive). **Stage 2** adds a tile layer that removes the
payload and iOS ceilings Stage 1 leaves behind.

`src/components/Viewer.tsx` is **modified, not replaced**. The ~40 lines that render the image are
the only part that is wrong; the view model, gesture handling, chrome, minimap and annotation
geometry are correct and are kept.

---

## What is actually wrong today (verified against the files on disk)

Probed from `data/media/`, not assumed:

```
master.jpg   5983x3499   20.9 MP   chroma 4:4:4   icc: yes
viewer.jpg   4000x2339    9.4 MP   chroma 4:2:0   icc: no    1.41 MB
```

1. **`maxZoom` ignores device pixel ratio.** `Viewer.tsx:137` computes `source.width / base.w` with
   `base.w` in **CSS** pixels. At max zoom the image is laid out at 4000 CSS px, which on a
   `devicePixelRatio: 2` display is **8000 device pixels rendering 4000 pixels of data**. The top
   half of the zoom range is pure browser interpolation. This is the dominant cause of "it looks
   like zooming into a jpg".
2. **The derivative holds 67% of the master.** 4000px vs 5983px. Real detail exists on disk and
   never reaches the browser.
3. **The pipeline downgrades chroma.** sharp's JPEG default is 4:2:0; the master is 4:4:4.
   `derivatives.ts:88` never overrides it. Small coloured stars and Ha/OIII boundaries are exactly
   the high-frequency chroma that subsampling destroys. The ICC profile is stripped too.
4. **The readout lies by omission.** `viewer-page.tsx:61` passes `masterWidth`/`masterHeight` from
   the master row, so the top bar reads `5983 x 3499 - 20.9 MP` while 9.4 MP is on screen.
5. **`viewer.webp` is generated and never served here.** `Viewer.tsx:421` is a bare `<img>` using
   `source.src`, and `source` is `jpeg ?? webp` (`:80`). The 1.04 MB WebP is dead weight in the
   export. (It would not fix chroma — lossy WebP is internally 4:2:0 as well.)

### Gotchas

- **`devicePixelRatio` is not available during SSR and changes at runtime.** Dragging a window
  between a Retina and a 1x monitor changes it live. Read it in an effect, default to 1, and
  subscribe to a `matchMedia` resolution query so the zoom ceiling follows.
- **sharp writes DZI levels all the way down to 1x1.** Nothing tells it to start at a floor; the
  redundant levels must be pruned after generation (§2.3).
- **The media route only serves whitelisted extensions.** `app/media/[...path]/route.node.ts:9`
  has no `.dzi` / `.xml` entry. Do not make the client parse the descriptor — derive tile URLs
  arithmetically from dimensions already in the database (§2.4). No route change needed.
- **`copyMedia()` in `export-site.ts:28` walks recursively and copies everything except
  `master.*`.** A `tiles/` directory is picked up automatically — including levels you forgot to
  prune, and they will be uploaded to Hostinger.
- **There is no way to re-derive an existing frame's media.** `processMaster()` is only reachable
  from `app/admin/upload/route.node.ts:64` and `scripts/seed.ts:108`, both of which need an upload.
  Both stages need a re-derive; §0 adds it first.

---

## 0. Prerequisite — a re-derive script

Both stages change `VARIANTS` and need existing frames rebuilt from their masters, which are on
disk at `data/media/<slug>/master.*`.

New `scripts/rederive-media.ts`, wired as `npm run media:rederive`:

- For each frame with a `master` row in `frame_images`, read the master file and call
  `processMaster()` with the existing `frameId` and `slug`.
- `processMaster()` already deletes and reinserts that frame's `frame_images` rows
  (`derivatives.ts:110`), so it is idempotent.
- Accept an optional slug argument for a single frame.
- Skip and warn (do not throw) when a master file is missing, so one gap does not abort the run.

---

# Stage 1 — honest 1:1, no tiles

## 1.1 DPR-aware zoom ceiling

Introduce `nativeZoom` as a first-class value: the zoom at which **one image pixel occupies one
device pixel**.

```ts
const [dpr, setDpr] = useState(1);            // effect-set; SSR-safe default
const nativeZoom = source && base.w > 0
  ? source.width / (base.w * dpr)
  : 1;
const maxZoom = clamp(nativeZoom, 1.5, 8);    // Stage 1: 1:1 is the ceiling
```

Everything downstream — the "1:1" button, the readout, the `image-rendering` switch, and Stage 2's
level selection — reads `nativeZoom`. It is the single place DPR enters the component.

## 1.2 Chroma and colour profile

In `VARIANTS` (`derivatives.ts:17`), pass through to the JPEG encoder:

```ts
.jpeg({ quality: v.jpegQuality, progressive: true, mozjpeg: true,
        chromaSubsampling: "4:4:4" })
```

and keep the ICC profile on the pipeline (`.keepIccProfile()`). Apply to `viewer` and `download`;
`article` and `thumb` are viewed small enough that 4:2:0 is the right trade and the bytes matter
more.

Expect roughly **+15% bytes** on the viewer derivative, for correct star colour.

## 1.3 Full-resolution viewer derivative

`VARIANTS` already says `longEdge: 6000`; the files on disk are 4000px and predate it. Re-deriving
(§0) makes 1:1 mean the master's actual resolution.

**Be aware this is the stage's cost.** Measured after implementation: the viewer derivative is
**5.18 MB** (5983x3499, 4:4:4, ICC) — noticeably worse than the ~3.5 MB estimated here, because
JPEG size does not scale linearly with pixel count on images this detailed. iOS Safari also still
downsamples above ~16 MP, so a phone will not reach true 1:1 no matter what is sent.

Stage 2 takes both back. The *code* from Stage 1 all survives; the derivative *size* is retuned in
§2.9. That retune is the only part of Stage 1 that Stage 2 undoes. **Do not deploy Stage 1 alone** —
at 5.18 MB per viewer open it is a real regression for anyone on a slow connection, and it only
exists to establish a correctness baseline.

### `viewer.webp` is dropped, not deferred

Planned for §2.9, resolved here because the measurement settled it. The WebP was 2.98 MB against
the JPEG's 5.18 MB, which looks like a free 42% saving — but **lossy WebP is internally 4:2:0 with
no opt-out**, so serving it would undo §1.2 on the one variant that most needs it. Since
`Viewer.tsx` renders a bare `<img>` off the JPEG, it was never served either. `formats` for
`viewer` is now `["jpeg"]`.

> **Follow-up for Stage 2:** `processMaster()` rewrites `frame_images` rows but does **not** delete
> derivative files that are no longer generated. Dropping the WebP left five orphaned 2-3 MB files
> on disk that `copyMedia()` would still have uploaded; they were removed by hand. Stage 2 shrinks
> the base derivative (§2.9) and prunes tile levels (§2.3), so it needs real pruning in
> `processMaster` — deleting stale files at the top level of the frame directory only, never
> `master.*` and never recursing into `tiles_files/`.

## 1.4 Make the readout mean 1:1

Today `zoom = 1` is fit and the readout shows `100%` there. An astrophotographer reads "100%" as
1:1, not as "fit to window". Change the readout to be native-relative:

```ts
const displayPct = Math.round((view.zoom / nativeZoom) * 100);
```

Fit then reads as roughly `38%` and the ceiling reads `100%`. Add a `1:1` control beside `Fit` that
calls `zoomToAbsolute(nativeZoom)` — the two ends of the range become directly reachable.

This is a deliberate visible change to existing behaviour. It is the honest labelling, but confirm
it before shipping in case the design intends fit-relative.

## 1.5 Interpolation above 1:1

`.image` in `Viewer.module.css:144` sets no `image-rendering`, so the browser smooth-filters. Above
`nativeZoom`, switch to `image-rendering: pixelated` so magnification shows crisp pixels the way
PixInsight does rather than a soft blur. In Stage 1 the ceiling *is* `nativeZoom`, so this only
takes effect once Stage 2 raises it (§2.5) — land the CSS hook now, exercised later.

## 1.6 Fix the dimension readout

`viewer-page.tsx:61` should report the dimensions of the **image actually being shown**, with the
master's dimensions only as a separate "master" figure if wanted. After §1.3 they coincide, but the
readout should not depend on that being true.

## Stage 1 verification

1. On a DPR-2 display, zoom to the ceiling: the readout reads `100%` and a star's airy disc shows
   hard pixel edges, not a soft blob.
2. A `node -e` probe of the regenerated `viewer.jpg` reports `chroma: 4:4:4` and `icc: true`.
3. Top bar dimensions match the served file.
4. On a DPR-1 display the ceiling is reached at a *higher* `view.zoom` than on DPR-2, and both show
   the same physical detail.
5. `npm run verify:deploy` still passes.

---

# Stage 2 — the tile layer

## 2.1 Architecture: the base image stays, tiles go on top

The single most important decision in this plan. The existing `<img>` is **kept as a permanent base
layer** inside `transformWrap`; tiles are painted **over** it, never instead of it.

This defuses the main risk of a hand-rolled tile viewer:

- There is always a complete image painted underneath, so a level transition can never flash a hole.
- A failed or slow tile degrades to today's behaviour rather than to blank canvas.
- Annotations, the minimap and the whole transform stay exactly where they are — the tile layer is
  a sibling inside the same coordinate space, so none of that geometry is touched.
- It is shippable incrementally: with the tile layer disabled the viewer is Stage 1.

## 2.2 Tile generation

One more entry in the `processMaster` pipeline, using sharp's built-in DZI writer:

```ts
await sharp(buffer, { limitInputPixels: false })
  .rotate()
  .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
  .tile({ layout: "dz", size: 512, overlap: 0 })
  .toFile(path.join(MEDIA_ROOT, slug, "tiles.dz"));
```

Produces `data/media/<slug>/tiles_files/<level>/<col>_<row>.jpeg` plus `tiles.dzi`.

> **The extension is `.jpeg`, not `.jpg`.** Measured, not assumed: a `suffix: ".jpg"` option is
> **silently overridden** by the pipeline's `.jpeg()` format — the run produced 126 `.jpeg` files
> and zero `.jpg`. Hardcoding `.jpg` in §2.4 would 404 every tile. Store the extension in the
> database next to `tileSize` rather than assuming it on the client. (`.jpeg` is already in the
> media route's `CONTENT_TYPES`, so nothing else changes.)

**512px, not the 256px default** — it cuts the file count 4x, which matters because these files get
FTP'd to Hostinger (§2.11). **`overlap: 0`** keeps the arithmetic trivial: tile `(x, y)` covers
source pixels `[x*512, (x+1)*512)`. See §2.10 for the contingency if seams appear.

Generation measured at **0.7s per 21 MP master** — negligible next to the derivative pass already
running, so it can go straight into the admin upload path with no queueing.

Record per frame in `frame_images` (or a small `frame_tiles` table): `maxLevel`, `tileSize`,
`overlap`, tile extension, and the level floor actually shipped.

## 2.3 Prune the redundant levels

sharp writes every level from 1x1 up. Measured output for the `ngc-6888` master (5983x3499),
`maxLevel = 13`:

| level | pixels | 512px tiles | on disk |
| --- | --- | --- | --- |
| 13 | 5983 x 3499 | 12 x 7 = **84** | **5.16 MB** |
| 12 | 2992 x 1750 | 6 x 4 = 24 | 1.80 MB |
| 11 | 1496 x 875 | 3 x 2 = 6 | 0.52 MB |
| 10 | 748 x 438 | 2 x 1 = 2 | 0.13 MB |
| <= 9 | ... | 10 files | 0.06 MB |
| | | **128 files** | **7.7 MB** |

Every level at or below the base derivative's width is already covered by the base `<img>`. With
the base at 3200px (§2.9), **only level 13 is needed** — one doubling above the base.

So: after `.tile()`, `fs.rm` every `tiles_files/<L>` where `levelWidth(L) <= baseWidth`. **84 tiles
and 5.16 MB per frame** instead of 128 files and 7.7 MB.

Edge tiles are partial and the ceil arithmetic in §2.4 predicts them exactly — verified: tile
`11_6` at level 13 measures **351 x 427**, matching `5983 - 11*512` and `3499 - 6*512`. Chroma
`4:4:4` propagates from the pipeline into every tile.

This also collapses the flicker problem to nothing: with one tile level there is exactly one
transition, base to tiles, and the base never leaves.

## 2.4 Tile URL contract — do not parse the descriptor

`level`, `tileSize` and the master dimensions are in the database, so the client computes URLs
arithmetically:

```ts
const scale  = 2 ** (maxLevel - level);
const levelW = Math.ceil(masterWidth  / scale);
const levelH = Math.ceil(masterHeight / scale);
const cols   = Math.ceil(levelW / tileSize);
const url = `${mediaBase}/tiles_files/${level}/${col}_${row}.jpg`;
```

No `.dzi` fetch, no XML parse, no round trip before the first tile, and no new content type in
`app/media/[...path]/route.node.ts:9`.

## 2.5 Level selection

Compute the device-pixel width the image currently occupies, and pick the smallest level that meets
or exceeds it:

```ts
const displayedDeviceWidth = base.w * view.zoom * dpr;
const wanted = levels.find(L => levelWidth(L) >= displayedDeviceWidth) ?? maxLevel;
const tilesActive = view.zoom > nativeZoom * (baseWidth / masterWidth);
```

Below that threshold the base image already has the pixels and the tile layer stays off entirely.

With tiles available, raise the ceiling past 1:1 for pixel-peeping:

```ts
const maxZoom = clamp(nativeZoom * OVERZOOM, 1.5, 16);   // OVERZOOM = 2
```

Above `nativeZoom`, §1.5's `image-rendering: pixelated` engages.

## 2.6 Visible tile set

From `view` and `canvas`, project the visible rect into level pixel space, convert to a col/row
range, and inflate by **one tile of margin** on each side so a pan reveals loaded tiles rather than
loading ones.

At a 1600x760 canvas on DPR-2, 1:1 needs 3200x1520 device px = **7 x 3 = 21 tiles**, ~35 with
margin. At the measured **63 KB average** for level 13 that is **~1.3 MB for a deep view**, ~2.2 MB
after panning around — and only when the user actually goes deep, versus 1.41 MB unconditionally
today.

## 2.7 Rendering — DOM tiles, not canvas

Render each visible tile as an absolutely positioned `<img>` inside `transformWrap`, at
`left/top/width/height` in the wrap's own coordinate space.

DOM over canvas because the compositor keeps handling the transform: pan and zoom stay as smooth as
they are now with no per-frame redraw, and the annotation layer needs no change because it already
lives in the same transform space. A canvas renderer would mean re-drawing every frame and
re-deriving annotation positions, for no gain at this scale.

Keep tiles mounted with `opacity` transitions on load so nothing pops, and `key` them by
`level/col/row` so React reuses the elements across pans.

The gesture-scoped `will-change` hack (`Viewer.tsx:57-77`) stays — it still applies to the wrap.

## 2.8 Load management

- Cap in-flight requests (~6) and drop requests for tiles no longer visible before issuing new ones.
- Keep a small LRU of recently decoded tiles so a zoom out and back in does not refetch.
- Never unmount the base layer.

Fast-pan thrash is the second real risk of hand-rolling; the visible-set cancellation above is the
mitigation, and it is testable in isolation.

## 2.9 Retune the base derivative

With tiles carrying everything above it, the base only has to serve fit view. Drop `viewer` from
6000 to **`longEdge: 3200`** — exactly a 1600 CSS px canvas at DPR 2.

Estimated from the current 4000px / 1.41 MB file: ~0.79 MB at 3200px, x1.15 for 4:4:4 =
**~0.91 MB**.

Net effect: fit view gets **lighter than today** (0.91 MB vs 1.41 MB), deep zoom becomes genuinely
1:1 for the first time, and the 21 MP iOS decode ceiling stops mattering because no single image
ever exceeds it.

Also drop the unused `viewer.webp` (defect 5 above), or start serving it via `<picture>`.

## 2.10 Seam contingency

`overlap: 0` can show hairline seams at non-integer scales, where adjacent tiles are each sampled
slightly short. If that appears:

1. First try snapping tile `left`/`top` to whole device pixels at the current scale.
2. If that is not enough, regenerate with `overlap: 1` and render each tile inset by one pixel.

Do not reach for `overlap: 1` pre-emptively — it complicates every offset in §2.4 and §2.6.

## 2.11 Static export and hosting

`copyMedia()` picks up `tiles_files/` with no change. The cost is honest and worth stating up front:

- **84 tiles/frame at a measured 63 KB average = 5.16 MB per frame**, versus ~2 MB of derivatives
  today.
- At 16 published frames: **1,344 extra files, ~83 MB**, on top of the current export.
- `master.*` is already excluded (`export-site.ts:25`), so masters are not part of this.

That is a real FTP upload cost. If it becomes painful, the escape hatch is a per-frame
`tilesEnabled` flag so only the frames worth deep-zooming ship a pyramid — the base layer means
frames without tiles still work, exactly as they do in Stage 1.

Add `tiles.dzi` to `SKIP_VARIANTS` — §2.4 means nothing ever requests it.

## Stage 2 verification

New `scripts/verify-tiles.ts` (`npm run check:tiles`), in the style of `verify-atlas.ts`:

1. For every frame with tiles, the pruned floor is above the base derivative width.
2. Tile counts match `ceil(levelW / 512) * ceil(levelH / 512)` for every shipped level — a wrong
   `maxLevel` produces plausible-looking URLs that 404 only at the edges of the image.
3. Every URL the client would compute for the deepest level resolves to a file on disk.
4. `npm run export` copies `tiles_files/` and no `.dzi`.

Manual:

5. Zoom past 1:1 on a DPR-2 display: crisp pixels, no seams at any zoom between fit and ceiling.
6. Pan hard and fast at max zoom: no permanent blank regions; the base image shows through while
   tiles arrive.
7. Throttled to Fast 3G: fit view renders from the base alone; tiles fill in progressively.
8. iPhone Safari: pinch to 1:1 shows detail the current build cannot reach.
9. Annotation markers still enclose the same sky at every zoom, tiles on and off.
10. `npm run verify:deploy` passes.

---

## Files touched

| File | Stage | Change |
| --- | --- | --- |
| `scripts/rederive-media.ts` | 0 | new |
| `src/server/media/derivatives.ts` | 1, 2 | chroma/ICC; `longEdge`; `.tile()`; level prune |
| `src/components/Viewer.tsx` | 1, 2 | `dpr` + `nativeZoom`; readout; `1:1` control; tile layer |
| `src/components/Viewer.module.css` | 1, 2 | `image-rendering`; tile layer styles |
| `app/(fullscreen)/frame/[slug]/full/viewer-page.tsx` | 1, 2 | honest dimensions; tile metadata |
| `src/server/db/schema.ts` + `queries.ts` | 2 | tile metadata (`maxLevel`, `tileSize`, floor) |
| `scripts/export-site.ts` | 2 | skip `tiles.dzi` |
| `scripts/verify-tiles.ts` | 2 | new |

## Out of scope (deliberately)

- OpenSeadragon. Assessed and rejected: it would require rewriting the chrome, minimap and
  annotation overlay — the finished parts — to gain a tile engine worth ~150 lines at this scale.
  Revisit if multi-panel mosaics above ~100 MP arrive.
- Canvas/WebGL rendering (§2.7).
- Tiling the `article` or `thumb` variants.
- Progressive/lossless formats (JPEG XL, AVIF) — see the existing note at `derivatives.ts:12`.
- Frame revision grouping — parked deliberately, to follow this work.
