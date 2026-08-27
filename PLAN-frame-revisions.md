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

## Status: the production survey has not been run

The design below rests on one claim — that the kind of relationship between two frames can be
derived rather than hand-classified — and that claim is **not yet verified against real revision
pairs**. The local database has five design frames and no revisions at all.

`npm run survey:revisions` (added with this plan, read-only) reports every multi-frame target, the
gear/filter/night/palette/scale differences within it, the kind the rule below would assign, and any
slug collisions. **Run it against production before building anything**, either on the server or
against a snapshot from `/admin/diagnostics` → Download database backup.

What is already known about production, from the sky atlas survey in `PLAN-sky-atlas.md`:

- **16 published frames**, Sep 2024 → Aug 2026.
- **Two targets already exist as A/B pairs**: `Sh2-157` (`sh2-157`, `sh2-157-b`, centres < 0.01°
  apart) and `IC 63` (`ic-63`, `ic-63-b`, ~0.12° apart).
- 15 of 16 frames are solved, so `plate_solves.pix_scale` is available as physical evidence for most.

And from the two frame drafts in the repo root, which are the live case:

| | `IC63-frame.json` | `IC63-B-frame.json` |
| --- | --- | --- |
| slug | `ic-63` | `ic-63` |
| revision | `""` | `""` |
| captured | 2025-07-22 | 2025-09-03 |
| integration | 2h 55m | **11h 29m** |

### Gotchas (found by running the survey against synthetic revisions)

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

| Signal | Source | Reads as |
| --- | --- | --- |
| plate scale | `plate_solves.pix_scale` | different optical train |
| gear, optics/camera keys only | `frame_gear` | different rig (corroborating) |
| palette / bandwidth | `frames` | different interpretation of the same data |
| filter totals, night count, integration | `frame_filters`, `nights`, `frames` | more data |
| none of the above | — | reprocess |

### 2.2 The rule

```
scaleChanged  = both solved && |pixScaleA - pixScaleB| / pixScaleA > 0.02
rigChanged    = scaleChanged || (opticsOrCameraGearDiffers && bothFramesHaveGear)
paletteChanged= palette or bandwidth differs
moreData      = integration increased || night count increased || filter totals increased

rigChanged     -> "new rig"     (accompanies)
paletteChanged -> "new palette"  (accompanies)
moreData       -> "more data"    (supersedes)
otherwise      -> "reprocess"    (supersedes)
```

`bothFramesHaveGear` is the guard for gotcha 1: a frame with no gear rows tells you nothing, so it
must not be read as "the rig changed". Scale, when available, outranks the gear text.

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

### 5.3 Compare

The payoff, and the reason this is worth building at all. Two revisions in the existing `Viewer`,
pan and zoom locked together, with a blink/swipe control.

**The plate solves make alignment free.** Both frames carry a full `wcs_json`, so the same sky
coordinate can be located in both images without any registration code — reusing `pixelToSky` /
`skyToPixel` from `src/server/astrometry/wcs.ts`. Note `PLAN-sky-atlas.md` gotcha 1: a frame's WCS is
scaled to the derivative that was solved, not the master, so it is self-consistent only with its own
`imageWidth`/`imageHeight`. Convert through sky coordinates, never by assuming the two images share a
pixel grid.

For a **reprocess** the two are pixel-identical in framing and the blink is exact. For **more data**
and **new rig** they are not, which is precisely when going through the WCS matters.

Underneath: the filter-mix bars side by side, and the integration delta.

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

- Merging or deleting frames. Never.
- Transitive relationship kinds across a chain (§2.3).
- Re-registering images pixel-wise; alignment goes through the existing plate solves or not at all.
- Grouping across catalog ids that are genuinely different objects in the same field.
- Mosaic panel awareness — the derivation will mislabel panels as "new rig"; §2.4's override is the
  answer until there is a real mosaic to design against.
