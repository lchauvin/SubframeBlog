"use client";

import { useMemo, useState } from "react";

import styles from "./Viewer.module.css";

export type TileSource = {
  /** Media URL of the pyramid directory, e.g. `/media/ngc-6888/tiles_files`. */
  baseUrl: string;
  /** Stored rather than assumed — libvips writes `.jpeg`, not `.jpg`. */
  extension: string;
  tileSize: number;
  maxLevel: number;
  minLevel: number;
  /** Full-resolution dimensions, i.e. the dimensions of `maxLevel`. */
  width: number;
  height: number;
};

type Props = {
  source: TileSource;
  view: { zoom: number; x: number; y: number };
  canvas: { w: number; h: number };
  /** The wrap's fit dimensions in CSS px — the tile layer's coordinate space. */
  base: { w: number; h: number };
  dpr: number;
  /** True above 1:1, where smoothing only blurs. Matches the base image. */
  pixelated: boolean;
};

/**
 * Extra rings of tiles fetched beyond the visible rect.
 *
 * Zero, deliberately, and measured: at 1:1 on a 1600x760 canvas the visible set
 * is 7x4 = 28 tiles (~1.7 MB), and one ring of margin makes it 9x6 = 54
 * (~3.3 MB). Nearly double the bytes to hide a transient, because the base
 * image is never unmounted — an edge revealed mid-pan is soft for a moment
 * rather than blank, which is the whole reason the base stays.
 *
 * If that transient ever reads as cheap-looking, the move is not a permanent
 * margin but prefetching one ring once the gesture settles; `interacting` in
 * Viewer already tracks exactly that moment.
 */
const MARGIN = 0;

const levelWidth = (source: TileSource, level: number) =>
  Math.ceil(source.width / 2 ** (source.maxLevel - level));
const levelHeight = (source: TileSource, level: number) =>
  Math.ceil(source.height / 2 ** (source.maxLevel - level));

/**
 * The pyramid, painted over the base image rather than replacing it.
 *
 * The base `<img>` in `Viewer` is never unmounted, so there is always a
 * complete picture underneath this layer: a level change cannot flash a hole,
 * and a tile that fails or is slow degrades to a softer image rather than a
 * blank one. That is what makes a hand-rolled tile layer safe here — the two
 * hard parts of one are level transitions and load thrash, and the first stops
 * being a correctness problem when nothing is ever uncovered.
 *
 * It lives inside the same transform wrap as the base image and the annotation
 * layer, so positions are in the wrap's own CSS-pixel space and the browser
 * compositor keeps handling pan and zoom. No per-frame redraw, and annotation
 * geometry needs no adjustment at all.
 */
export function ViewerTiles({ source, view, canvas, base, dpr, pixelated }: Props) {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());

  const level = useMemo(() => {
    const wanted = base.w * view.zoom * dpr;
    for (let l = source.minLevel; l <= source.maxLevel; l++) {
      if (levelWidth(source, l) >= wanted) return l;
    }
    return source.maxLevel;
  }, [source, base.w, view.zoom, dpr]);

  const tiles = useMemo(() => {
    if (base.w <= 0 || base.h <= 0) return [];

    const lw = levelWidth(source, level);
    const lh = levelHeight(source, level);
    const cols = Math.ceil(lw / source.tileSize);
    const rows = Math.ceil(lh / source.tileSize);

    // Visible rect, projected back into wrap-local CSS px. The wrap is centred
    // in the canvas, then translated by (x, y) and scaled about its own centre,
    // so a local point p maps to (p - base/2) * zoom + offset from the centre.
    const localX = (screenHalf: number, offset: number) =>
      base.w / 2 + (screenHalf - offset) / view.zoom;
    const localY = (screenHalf: number, offset: number) =>
      base.h / 2 + (screenHalf - offset) / view.zoom;

    const minX = localX(-canvas.w / 2, view.x);
    const maxX = localX(canvas.w / 2, view.x);
    const minY = localY(-canvas.h / 2, view.y);
    const maxY = localY(canvas.h / 2, view.y);

    const toCol = (localPx: number) => Math.floor((localPx * (lw / base.w)) / source.tileSize);
    const toRow = (localPx: number) => Math.floor((localPx * (lh / base.h)) / source.tileSize);

    const c0 = Math.max(0, toCol(minX) - MARGIN);
    const c1 = Math.min(cols - 1, toCol(maxX) + MARGIN);
    const r0 = Math.max(0, toRow(minY) - MARGIN);
    const r1 = Math.min(rows - 1, toRow(maxY) + MARGIN);

    const out: {
      key: string;
      src: string;
      left: number;
      top: number;
      width: number;
      height: number;
    }[] = [];

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const sx = c * source.tileSize;
        const sy = r * source.tileSize;
        // Edge tiles are partial: the last column of a 5983px level is 351px.
        const tw = Math.min(source.tileSize, lw - sx);
        const th = Math.min(source.tileSize, lh - sy);
        if (tw <= 0 || th <= 0) continue;

        out.push({
          key: `${level}/${c}_${r}`,
          src: `${source.baseUrl}/${level}/${c}_${r}.${source.extension}`,
          left: (sx / lw) * base.w,
          top: (sy / lh) * base.h,
          width: (tw / lw) * base.w,
          height: (th / lh) * base.h,
        });
      }
    }
    return out;
  }, [source, level, base.w, base.h, canvas.w, canvas.h, view.x, view.y, view.zoom]);

  return (
    <div className={styles.tileLayer} aria-hidden="true">
      {tiles.map((t) => (
        <img
          key={t.key}
          className={`${styles.tile} ${pixelated ? styles.tilePixelated : ""}`}
          src={t.src}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() =>
            setLoaded((prev) => (prev.has(t.key) ? prev : new Set(prev).add(t.key)))
          }
          style={{
            left: `${t.left}px`,
            top: `${t.top}px`,
            width: `${t.width}px`,
            height: `${t.height}px`,
            // Fade in once decoded so a tile never pops in over the base. Keys
            // already loaded render opaque immediately on a return visit.
            opacity: loaded.has(t.key) ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
}
