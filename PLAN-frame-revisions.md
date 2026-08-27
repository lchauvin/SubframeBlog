# Frame revisions — implementation plan

## Goal

Make a **target** the thing the site is organised around, with the processings of it hanging off it,
instead of every processing being an unrelated row in the log.

Today two frames of one object are strangers on the public site. Only `groupRevisions()` in
`src/server/atlas/build.ts` knows they are related, and only for drawing the sky atlas. The log shows
them as near-identical entries with nothing explaining the difference, the article prints
`018 / B` as dead text with no link to `018 / A`, and two frames of `IC 63` already collide on the
slug `ic-63` so the second cannot be imported without hand-editing.

**This plan does not collapse revisions uniformly**, because they are not one thing. A revision can be
a reprocess of the same subs, the same target with more integration, or a different rig entirely.
Collapsing all three loses the distinction that makes them worth showing. What gets built instead is
a *typed* relationship, where the type is **derived from data already stored** and decides whether
the pair collapses.

---

## Status: surveyed against production, and it changed the rule twice

Run on the 2026-08-27 snapshot: **16 frames, 14 targets, 2 with revisions.** Both now collapse
correctly — 16 frames render as 14 log rows.

| pair | verdict | why |
| --- | --- | --- |
| `sh2-157` → `sh2-157-b` | **reprocess** | identical integration, filters and nights; plate scale 0.17% apart |
| `ic-63` → `ic-63-b` | **more data** | `reframed · HaRGB 7nm → HSRGB 7nm · +8h 34m · +11 nights` |

Neither classified correctly on the first attempt, and the corrections are the substance of this
plan rather than footnotes to it.

**Palette does not outrank more data.** IC 63 goes `HaRGB` → `HSRGB` *because SII was added*, along
with 8h 34m and eleven nights. "New palette" was meant to mean the same subs mapped differently — an
interpretation. A palette label also moves when a new filter is acquired, and then it is describing
acquisition. Reading it as reinterpretation left two rows in the log where the newer frame plainly
supersedes the older. `moreData` is now checked first; the palette only decides when the data behind
it did not move.

**Plate scale is not a property of the rig.** This plan originally made scale authoritative because
it is measured from the sky rather than typed by a person. It is also changed by *cropping*: export a
tighter crop at the same pixel dimensions and arcsec/px moves while the telescope sits untouched.
IC 63's two frames are **14.5% apart in plate scale with byte-identical optics and camera** — both
masters 5983x3499, both solved on a 2048px derivative, so the numbers are directly comparable. Sh2-157's
differ by 0.17%. Recorded optics now decide, and scale is only the fallback for frames that record
none. A scale change under unchanged optics is reported as `reframed`, because it is why two
revisions do not overlay.

**Optical gear is compared as a set of values, not key=value pairs.** The same scope gets listed
under "Optics" on one frame and "Telescope" on another. Comparing pairs turns that into a phantom rig
change; comparing values still catches a genuinely different scope.

> The survey itself was wrong for its first run. It re-implemented the derivation instead of calling
> it, drifted from the real rule, and confidently reported Sh2-157 as a new rig when the app
> classified it a reprocess. It now calls `classifyRevision` directly. A validation tool that answers
> a different question than production is worse than none, because it is believed.

### Gotchas (from synthetic pairs, before the production run)

1. **Comparing `frame_gear` row sets is too brittle to lead the derivation.** Gear is a per-frame
   copy of the current rig, so it drifts for reasons that have nothing to do with changing equipment
   — a frame authored before per-frame gear existed has none, an edited rig list changes wording, a
   duplicated row changes the set. In testing, a pair that was unambiguously *more data* (+10h, same
   optics) was labelled **new rig** purely because one side had an extra identical-looking row.
   Text equality on gear is evidence, not proof.
2. **Image scale is the honest signal for "different rig".** `plate_solves.pix_scale` is measured
   from the sky, not typed by a person. If the scale matches, the optical train did not change in any
   way that matters, whatever the gear text says. `frames.arcsec_per_px` is hand-entered and must
   **not** be used for this — `PLAN-sky-atlas.md` §Gotchas already records that it does not reconcile
   with the solver for any frame checked.
3. **Ordering the chain by `captured_on` makes each hop relative to the previous frame, not the
   first.** A three-link chain compares B→C, not A→C, so a "reprocess" hop can show *less*
   integration than two hops back and still be correctly labelled. This is why each hop is labelled
   independently and nothing transitive is computed (§2.3).
4. **Slug collisions are silent until import.** `frameSlug(catalogId, revision)` returns the same
   slug for two frames with the same catalog id and revision, and `slugExists` then blocks the second
   with a form error. The survey lists these; §4 removes the class of problem.

---

## 1. The relationship model

One nullable column on `frames`:

```ts
parentFrameId: integer("parent_frame_id").references(() => frames.id, { onDelete: "set null" }),
```

Deliberately **not** a taxonomy table, and deliberately **not** a stored `kind`. A stored kind is a
copy of facts that already exist elsewhere and will go stale the moment a filter row or a gear row is
edited. The kind is derived on read (§2) and overridden only where the derivation is wrong (§2.4).

`onDelete: "set null"` rather than cascade: deleting a frame must orphan its children, never delete
them.

## 2. Deriving the kind

A pure function of two frames and their related rows. No new authoring at import time.

### 2.1 Signals, in order of trustworthiness

Revised after the production run — the first version of this table had the top two rows the wrong way
round.

| Signal | Source | Reads as |
| --- | --- | --- |
| optics/camera values | `frame_gear` | different rig |
| plate scale | `plate_solves.pix_scale` | different rig **only when no optics are recorded**; otherwise a crop |
| integration, night count, filter totals | `frames`, `nights`, `frame_filters` | more data |
| palette / bandwidth | `frames` | different interpretation, **only if the data did not move** |
| none of the above | — | reprocess |

### 2.2 The rule

```
scaleChanged   = both solved && |pixScaleA - pixScaleB| / pixScaleA > 0.02
gearChanged    = both record optics && the SET OF VALUES differs
rigChanged     = bothRecordOptics ? gearChanged : scaleChanged
paletteChanged = palette or bandwidth differs
moreData       = integration increased || night count increased

rigChanged     -> "new rig"      (accompanies)
moreData       -> "more data"    (supersedes)
paletteChanged -> "new palette"  (accompanies)
filtersChanged -> "more data"    (supersedes)
otherwise      -> "reprocess"    (supersedes)
```

Three things in that order are deliberate and each cost a wrong answer on real data:

- **Optics before scale.** Cropping moves plate scale without touching the rig (IC 63, 14.5%).
- **More data before palette.** A palette label follows a newly added filter (IC 63, `HaRGB` →
  `HSRGB` because SII arrived).
- **Values, not key=value pairs**, for the gear comparison, so a renamed key is not a rig change.

A frame that records no optics is silence, never evidence — which is why the fallback is keyed on
whether optics exist at all rather than on whether they differ. A scale change under unchanged optics
is surfaced as `reframed` rather than dropped: it is why two revisions of one target do not overlay.

### 2.3 Chains

Each hop is labelled against its **immediate parent** only. A→B "reprocess" and B→C "more data" does
not make A→C anything — the article shows the chain with each hop labelled, and no transitive kind is
computed or stored. Attempting one produces confident nonsense (gotcha 3).

### 2.4 Override

A `revisionKind` column, nullable, empty meaning "derive it". Set from a dropdown in `FrameForm`.
Needed for the cases the diff cannot see: mosaic panels, a heavy re-crop, or a reprocess that also
happened to gain a night. Ship the derivation, keep the escape hatch — do not ask the author to
classify every frame.

## 3. What collapses

The kind decides, and this is the whole reason for typing the relationship:

| Kind | Log | Why |
| --- | --- | --- |
| **reprocess** | collapse, newest shown | The old pixels are history, not a separate photograph. |
| **more data** | collapse, newest shown | The delta *is* the story: 2h 55m → 11h 29m. |
| **new rig** | **both entries stay**, cross-linked | Same object, genuinely different photograph. |
| **new palette** | **both entries stay**, cross-linked | An interpretation, not a correction. |

The line underneath: collapse when the newer frame **supersedes** the older; keep both when it merely
**accompanies** it.

Nothing is ever merged or deleted. Every frame keeps its own URL forever, including collapsed ones —
they leave the log listing, not the site.

## 4. Slug assignment

`frameSlug(catalogId, revision)` collides whenever revision is empty and the target repeats, which is
the state both `IC 63` drafts are in. On collision, auto-assign the next free revision letter rather
than failing the import: `ic-63`, then `ic-63-b`, `ic-63-c`. The admin can still override.

This also sets `parentFrameId` automatically — the frame it collided with is, by definition, another
frame of the same target, and the newest existing one is the parent.

## 5. UI

### 5.1 Log

One row per collapsed group, newest image, with a marker on the kicker line: `3 versions · 21h
total`. Accompanying frames remain their own rows, with a `also shot with…` cross-link.

### 5.2 Article

A revision rail listing every frame in the group, current one marked, each hop labelled with its
derived kind and delta (`+8h 34m`, `SHO → HOO`, `RC8 → Esprit 100`).

### 5.3 Compare — built, then removed

Built and reverted on 2026-08-27. Restore from `76538ea`, `f6205fd`, `882d149`, `02e4c23` if it is
picked up again; everything below is what those commits learned, and is worth reading before a
second attempt.

**The registration was never the problem.** Both frames carry a full WCS, so going through sky
coordinates gives the mapping for free — verified against the live images three ways: warping one
frame into the other and scanning a +/-24px offset grid peaks sharply at zero (59 star hits against
10-19 anywhere else); the same patch of sky cropped from both shows the same nebula at the same
orientation; and the derived scale, 0.8541, is the ratio of the two plate scales, 3.519/4.116 =
0.8550. The component's CSS transform reproduced that warp to 0.00px.

What defeated it was everything layered on top:

1. **The swipe divider was cut in the wrong coordinate space.** Its position is a percentage of the
   canvas, but the clip was applied inside the transform, where a percentage means a percentage of
   the image. The view opens zoomed on the shared region, so the two never agreed; at the extremes
   one frame replaced the other wholesale, which is indistinguishable from failed registration.
2. **The divider was hit-tested by proximity**, so a missed grab panned the image instead — two
   screenshots of one comparison no longer shared a viewport.
3. **IC 63's frames are 99° apart and share 69% of the field.** Even correctly drawn, a swipe puts
   sky only one frame has beside sky both have, and the eye reads that as drift. Clipping to the
   intersection polygon helped and was not enough.
4. **The depths differ 4x** — 2h55m against 11h29m — so the nebula that dominates one is barely
   present in the other, and no amount of geometry makes those look like the same picture.

A second attempt should probably not be a swipe at all. Blink with both frames matched in stretch,
or a small aligned thumbnail pair, would sidestep 1 to 4 entirely. And it should carry a visible
registration check — a marker drawn at one sky coordinate in *both* layers, which coincide when the
alignment is right — so "is this aligned?" stops being a judgement call. Three rounds went into
answering that question with offline measurements when the UI could have answered it directly.

## 6. Verification

`npm run survey:revisions` is the standing check — it prints the derived kind for every real pair, so
a change to the rule can be eyeballed against every target at once rather than against a fixture.

New `scripts/verify-revisions.ts` (`npm run check:revisions`) asserts:

1. No `parentFrameId` cycles, and no frame parented to itself.
2. Every group's collapse decision is stable when the group is re-sorted — order must not change
   which frames appear in the log.
3. Every collapsed frame is still reachable at its own URL.
4. The derivation is total: every pair yields exactly one kind, including when one side is unsolved
   and has no gear.
5. Slug auto-assignment produces no collisions across the whole table.

## Out of scope

- The compare view, for now — see §5.3 for what went wrong and what to do differently.
- Merging or deleting frames. Never.
- Transitive relationship kinds across a chain (§2.3).
- Re-registering images pixel-wise; alignment goes through the existing plate solves or not at all.
- Grouping across catalog ids that are genuinely different objects in the same field.
- Mosaic panel awareness — the derivation will mislabel panels as "new rig"; §2.4's override is the
  answer until there is a real mosaic to design against.
