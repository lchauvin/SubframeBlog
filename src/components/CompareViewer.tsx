"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./CompareViewer.module.css";

export type CompareAlignment = {
  scale: number;
  rotation: number;
  tx: number;
  ty: number;
  refWidth: number;
  refHeight: number;
  otherWidth: number;
  otherHeight: number;
  refScaleArcsec: number;
  otherScaleArcsec: number;
};

export type CompareSide = {
  slug: string;
  label: string;
  src: string;
  width: number;
  height: number;
  capturedLabel: string;
  integrationLabel: string;
  paletteLabel: string;
};

export type CompareOverlap = {
  x: number;
  y: number;
  width: number;
  height: number;
  fraction: number;
  points: { x: number; y: number }[];
};

export type CompareViewerProps = {
  title: string;
  reference: CompareSide;
  other: CompareSide;
  /** null when either frame is unsolved — the images then cannot be registered. */
  alignment: CompareAlignment | null;
  /** Where both frames see the same sky. null when they share nothing. */
  overlap: CompareOverlap | null;
  changes: string[];
  kindLabel: string;
  backHref: string;
};

type Mode = "swipe" | "blink";
type View = { zoom: number; x: number; y: number };

const FIT: View = { zoom: 1, x: 0, y: 0 };
const WHEEL_STEP = 1.12;
const MAX_ZOOM = 8;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Two processings of one target, registered through their plate solves.
 *
 * The pan and zoom here is a deliberately smaller thing than `Viewer`'s rather
 * than a shared abstraction: the divider is itself a drag, so pointer handling
 * has to distinguish "moving the split" from "panning the image", and there is
 * no minimap or annotation layer to carry. What matters is that both frames
 * live in one transform, so they cannot drift apart no matter how far in you go.
 */
export function CompareViewer(props: CompareViewerProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(FIT);
  const [mode, setMode] = useState<Mode>("swipe");
  const [split, setSplit] = useState(50);
  const [showOther, setShowOther] = useState(false);
  const [dragging, setDragging] = useState<"pan" | "split" | null>(null);
  /** Whether to show only the sky both frames cover. */
  const [sharedOnly, setSharedOnly] = useState(true);

  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const didInitialFit = useRef(false);

  const aspect =
    props.reference.height > 0 ? props.reference.width / props.reference.height : 1.71;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setCanvas({ w: rect.width, h: rect.height });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setCanvas({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const base = useMemo(() => {
    if (canvas.w <= 0 || canvas.h <= 0) return { w: 0, h: 0 };
    const w = Math.min(canvas.w, canvas.h * aspect);
    return { w, h: w / aspect };
  }, [canvas.w, canvas.h, aspect]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const maxX = Math.max(0, (base.w * z - canvas.w) / 2);
      const maxY = Math.max(0, (base.h * z - canvas.h) / 2);
      return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    },
    [base.w, base.h, canvas.w, canvas.h],
  );

  /**
   * Frames the shared sky rather than the reference frame.
   *
   * Two processings of a target need not cover the same field — IC 63's share
   * just half of it, 99° apart in rotation — and opening on the reference frame
   * puts mostly un-comparable sky on screen. The registration is exact; there
   * is simply nothing under most of it, which is indistinguishable from being
   * broken until you go looking for the overlap yourself.
   */
  const fitOverlap = useCallback(() => {
    const overlap = props.overlap;
    const alignment = props.alignment;
    if (!overlap || !alignment || base.w <= 0 || canvas.w <= 0) return;
    const k = base.w / alignment.refWidth;
    const w = overlap.width * k;
    const h = overlap.height * k;
    if (w <= 0 || h <= 0) return;
    // A little margin, so the shared region is not flush against the edges.
    const zoom = clamp(Math.min(canvas.w / w, canvas.h / h) * 0.94, 1, MAX_ZOOM);
    const cx = (overlap.x + overlap.width / 2) * k;
    const cy = (overlap.y + overlap.height / 2) * k;
    setView({
      zoom,
      ...clampPan(-(cx - base.w / 2) * zoom, -(cy - base.h / 2) * zoom, zoom),
    });
  }, [props.overlap, props.alignment, base.w, base.h, canvas.w, canvas.h, clampPan]);

  // Once, when the canvas first has a size. Never again, or it would yank the
  // view back every time the window resized.
  useEffect(() => {
    if (didInitialFit.current || base.w <= 0 || canvas.w <= 0) return;
    didInitialFit.current = true;
    fitOverlap();
  }, [base.w, canvas.w, fitOverlap]);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((prev) => {
        const next = clamp(prev.zoom * factor, 1, MAX_ZOOM);
        if (Math.abs(next - prev.zoom) < 1e-6) return prev;
        if (next === 1) return FIT;
        const cx = anchor ? anchor.x - canvas.w / 2 : 0;
        const cy = anchor ? anchor.y - canvas.h / 2 : 0;
        const k = next / prev.zoom;
        return {
          zoom: next,
          ...clampPan(cx - (cx - prev.x) * k, cy - (cy - prev.y) * k, next),
        };
      });
    },
    [canvas.w, canvas.h, clampPan],
  );

  // Native listener so preventDefault applies — React's onWheel is passive.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(props.backHref);
      else if (e.key === "0") {
        setSharedOnly(false);
        setView(FIT);
      } else if (e.key === "1") {
        setSharedOnly(true);
        fitOverlap();
      }
      else if (e.key === "b" || e.key === "B") {
        setMode("blink");
        setShowOther((v) => !v);
      } else if (e.key === "s" || e.key === "S") setMode("swipe");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, props.backHref, fitOverlap]);

  const splitFromEvent = (clientX: number) => {
    const el = canvasRef.current;
    if (!el) return split;
    const rect = el.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // Grabbing near the divider moves the split; anywhere else pans. Without
    // this the two gestures fight over the same drag.
    if (mode === "swipe" && Math.abs(splitFromEvent(e.clientX) - split) < 3) {
      setDragging("split");
      return;
    }
    setDragging("pan");
    lastPoint.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging === "split") {
      setSplit(splitFromEvent(e.clientX));
      return;
    }
    if (dragging !== "pan" || !lastPoint.current) return;
    const dx = e.clientX - lastPoint.current.x;
    const dy = e.clientY - lastPoint.current.y;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    setView((prev) => ({ ...prev, ...clampPan(prev.x + dx, prev.y + dy, prev.zoom) }));
  };

  const onPointerUp = () => {
    setDragging(null);
    lastPoint.current = null;
  };

  /**
   * The other frame's transform, in the reference frame's display space.
   *
   * `alignment` is expressed in the reference solve's own pixel units, so
   * everything is multiplied by `k` — the CSS pixels per reference pixel — to
   * land in the layout. CSS applies the list right to left, so scale, then
   * rotate, then translate, which is exactly `scale * R * b + t`.
   */
  const otherStyle = useMemo(() => {
    const a = props.alignment;
    if (!a || base.w <= 0) return null;
    const k = base.w / a.refWidth;
    return {
      width: `${a.otherWidth}px`,
      height: `${a.otherHeight}px`,
      transformOrigin: "0 0",
      transform:
        `translate(${(a.tx * k).toFixed(3)}px, ${(a.ty * k).toFixed(3)}px) ` +
        `rotate(${((a.rotation * 180) / Math.PI).toFixed(4)}deg) ` +
        `scale(${(k * a.scale).toFixed(6)})`,
    } as const;
  }, [props.alignment, base.w]);

  /**
   * Clips the whole comparison to the region both frames cover.
   *
   * Without it the swipe puts sky only one frame has next to sky both have, and
   * the eye reads that discontinuity as a registration failure — which is what
   * it looked like on IC 63, where the frames are 99° apart and share 69% of the
   * field. Everything inside this outline is comparable; nothing outside it is.
   */
  const sharedClip = useMemo(() => {
    const overlap = props.overlap;
    const alignment = props.alignment;
    if (!sharedOnly || !overlap || !alignment || overlap.points.length < 3) return undefined;
    const pts = overlap.points
      .map(
        (p) =>
          `${((p.x / alignment.refWidth) * 100).toFixed(3)}% ${((p.y / alignment.refHeight) * 100).toFixed(3)}%`,
      )
      .join(", ");
    return `polygon(${pts})`;
  }, [sharedOnly, props.overlap, props.alignment]);

  /**
   * The divider, converted from canvas space into the wrap's own.
   *
   * `split` is where the handle sits on screen, but the clip is applied to a
   * layer *inside* the transform, so a percentage there means a percentage of
   * the image — which is a different place entirely the moment the view is
   * zoomed or panned. The comparison opens zoomed on the shared region, so it
   * was never not zoomed: the reveal boundary sat far from the line the user
   * was dragging, and at the extremes it left the frame altogether, so one
   * image appeared to replace the other wholesale. Two frames swapping in full
   * look exactly like two frames that will not register.
   */
  const splitInWrap = useMemo(() => {
    if (base.w <= 0 || canvas.w <= 0) return split;
    const screenX = (split / 100) * canvas.w - canvas.w / 2;
    const localX = base.w / 2 + (screenX - view.x) / view.zoom;
    return clamp((localX / base.w) * 100, 0, 100);
  }, [split, base.w, canvas.w, view.x, view.zoom]);

  const rotationDeg = props.alignment ? (props.alignment.rotation * 180) / Math.PI : 0;
  const scalePct = props.alignment ? (props.alignment.scale - 1) * 100 : 0;

  const otherVisible = mode === "blink" ? showOther : true;

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>{props.title}</span>
          <span className={styles.subtitle}>
            {props.kindLabel}
            {props.changes.length ? ` · ${props.changes.join(" · ")}` : ""}
          </span>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.control} ${mode === "swipe" ? styles.active : ""}`}
            onClick={() => setMode("swipe")}
          >
            Swipe
          </button>
          <button
            type="button"
            className={`${styles.control} ${mode === "blink" ? styles.active : ""}`}
            onClick={() => {
              setMode("blink");
              setShowOther((v) => !v);
            }}
            title="Press B to flip"
          >
            Blink
          </button>
          <button
            type="button"
            className={`${styles.control} ${sharedOnly ? styles.active : ""}`}
            onClick={() => {
              setSharedOnly(true);
              fitOverlap();
            }}
          >
            Shared sky
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => {
              setSharedOnly(false);
              setView(FIT);
            }}
          >
            Whole frame
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => router.push(props.backHref)}
          >
            Close
          </button>
        </div>
      </div>

      {props.alignment && props.overlap && props.overlap.fraction < 0.9 ? (
        <div className={styles.notice}>
          These two frames only share {Math.round(props.overlap.fraction * 100)}% of their sky
          {Math.abs(rotationDeg) >= 1
            ? `, and the second is rotated ${Math.abs(rotationDeg).toFixed(0)}° from the first`
            : ""}
          . Only the region they both cover is shown, because outside it one of them has no data
          at all and the gap reads as a registration failure. Press 0 for the whole frame, 1 to
          come back.
        </div>
      ) : null}

      {!props.alignment ? (
        <div className={styles.notice}>
          These two frames cannot be registered — one of them has no plate solve, so there is no
          shared sky coordinate to line them up on. They are shown at the same size instead, which
          will not overlay if the framing differs.
        </div>
      ) : null}

      <div
        ref={canvasRef}
        className={`${styles.canvas} ${dragging === "pan" ? styles.grabbing : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className={styles.centerBox}>
          <div
            className={styles.transformWrap}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              width: base.w || undefined,
              height: base.h || undefined,
              opacity: base.w > 0 ? 1 : 0,
              clipPath: sharedClip,
            }}
          >
            <img
              className={styles.image}
              src={props.reference.src}
              alt={props.reference.label}
              draggable={false}
              style={{ width: "100%", height: "100%" }}
            />

            {/* Clipped rather than unmounted, so the browser keeps one decoded
                copy and the swipe costs nothing per frame. */}
            <div
              className={styles.otherLayer}
              style={{
                opacity: otherVisible ? 1 : 0,
                clipPath:
                  mode === "swipe" ? `inset(0 0 0 ${splitInWrap.toFixed(4)}%)` : undefined,
              }}
            >
              {otherStyle ? (
                <img
                  className={styles.image}
                  src={props.other.src}
                  alt={props.other.label}
                  draggable={false}
                  style={otherStyle}
                />
              ) : (
                <img
                  className={styles.image}
                  src={props.other.src}
                  alt={props.other.label}
                  draggable={false}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </div>
          </div>
        </div>

        {mode === "swipe" ? (
          <div
            className={styles.divider}
            style={{ left: `${split}%` }}
            role="separator"
            aria-label="Drag to compare"
            aria-valuenow={Math.round(split)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onPointerDown={(e) => {
              // Its own target, so grabbing it never falls through to a pan.
              // Proximity hit-testing missed often enough that a drag meant to
              // swipe silently moved the image instead, which made two
              // screenshots of the same comparison disagree.
              e.stopPropagation();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDragging("split");
            }}
            onPointerMove={(e) => {
              if (dragging === "split") setSplit(splitFromEvent(e.clientX));
            }}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSplit((v) => clamp(v - 2, 0, 100));
              else if (e.key === "ArrowRight") setSplit((v) => clamp(v + 2, 0, 100));
            }}
          >
            <span className={styles.dividerHandle} />
          </div>
        ) : null}

        <div className={styles.sideLabels}>
          <span className={styles.sideLabel}>
            {props.reference.label} · {props.reference.capturedLabel}
          </span>
          <span className={`${styles.sideLabel} ${styles.sideLabelRight}`}>
            {props.other.label} · {props.other.capturedLabel}
          </span>
        </div>
      </div>

      <div className={styles.bottomBar}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{props.reference.label}</span>
          <span className={styles.statValue}>
            {props.reference.integrationLabel} · {props.reference.paletteLabel}
          </span>
        </div>
        {props.alignment ? (
          <div className={styles.stat}>
            <span className={styles.statLabel}>Registration</span>
            <span className={styles.statValue}>
              {Math.abs(rotationDeg) >= 0.05 ? `rotated ${rotationDeg.toFixed(1)}°` : "no rotation"}
              {" · "}
              {Math.abs(scalePct) >= 0.5 ? `${scalePct > 0 ? "+" : ""}${scalePct.toFixed(1)}% scale` : "same scale"}
              {props.overlap ? ` · ${Math.round(props.overlap.fraction * 100)}% shared sky` : ""}
            </span>
          </div>
        ) : null}
        <div className={styles.stat}>
          <span className={styles.statLabel}>{props.other.label}</span>
          <span className={styles.statValue}>
            {props.other.integrationLabel} · {props.other.paletteLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
