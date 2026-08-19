"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { VariantImages } from "@/server/db/queries";
import styles from "./Viewer.module.css";

const ANNOT_STORAGE_KEY = "astroblog:annotations";
const WHEEL_STEP = 1.12;
const BUTTON_STEP = 1.35;

export type ViewerAnnotation = {
  id: number;
  label: string;
  xPct: number;
  yPct: number;
  radiusPx: number;
};

export type ViewerProps = {
  title: string;
  alt: string;
  image: VariantImages;
  masterWidth: number;
  masterHeight: number;
  arcsecPerPx: number | null;
  annotations: ViewerAnnotation[];
  metaLine: string;
  chipLabel: string;
  articleHref: string;
  downloadHref: string | null;
  contactHref: string;
};

/** zoom, x and y move together, so they live in one state object — separate
 *  states (or refs mirrored on render) drop steps when React batches rapid
 *  clicks or wheel ticks. */
type View = { zoom: number; x: number; y: number };

const FIT: View = { zoom: 1, x: 0, y: 0 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function Viewer(props: ViewerProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const [annotationsOn, setAnnotationsOn] = useState(true);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const source = props.image.jpeg ?? props.image.webp ?? null;
  const aspect = source && source.height > 0 ? source.width / source.height : 1.71;

  // Measure the canvas so geometry uses real numbers rather than the
  // prototype's hardcoded 1600 / 760 / 1.71.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvas({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ANNOT_STORAGE_KEY);
      if (stored !== null) setAnnotationsOn(stored === "1");
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);

  const toggleAnnotations = useCallback(() => {
    setAnnotationsOn((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(ANNOT_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /** z = 1 shows the whole frame — so "Fit" is honest and the range is meaningful. */
  const base = useMemo(() => {
    if (canvas.w <= 0 || canvas.h <= 0) return { w: 0, h: 0 };
    const w = Math.min(canvas.w, canvas.h * aspect);
    return { w, h: w / aspect };
  }, [canvas.w, canvas.h, aspect]);

  // Never magnify past the pixels that actually exist in the derivative.
  const maxZoom = useMemo(() => {
    if (!source || base.w <= 0) return 8;
    return clamp(source.width / base.w, 1.5, 8);
  }, [source, base.w]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const maxX = Math.max(0, (base.w * z - canvas.w) / 2);
      const maxY = Math.max(0, (base.h * z - canvas.h) / 2);
      return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    },
    [base.w, base.h, canvas.w, canvas.h],
  );

  /**
   * Anchored zoom: the point under `anchor` (canvas coords) stays put. The
   * prototype only rescaled the offsets, which keeps the centre fixed instead.
   * `nextZoom` is a function of the previous zoom so batched events compound.
   */
  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((prev) => {
        const next = clamp(prev.zoom * factor, 1, maxZoom);
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
    [maxZoom, canvas.w, canvas.h, clampPan],
  );

  const zoomToAbsolute = useCallback(
    (target: number, anchor?: { x: number; y: number }) =>
      setView((prev) => {
        const next = clamp(target, 1, maxZoom);
        if (Math.abs(next - prev.zoom) < 1e-6) return prev;
        if (next === 1) return FIT;

        const cx = anchor ? anchor.x - canvas.w / 2 : 0;
        const cy = anchor ? anchor.y - canvas.h / 2 : 0;
        const k = next / prev.zoom;

        return {
          zoom: next,
          ...clampPan(cx - (cx - prev.x) * k, cy - (cy - prev.y) * k, next),
        };
      }),
    [maxZoom, canvas.w, canvas.h, clampPan],
  );

  const reset = useCallback(() => setView(FIT), []);
  const close = useCallback(() => router.push(props.articleHref), [router, props.articleHref]);

  // Native listener so preventDefault actually applies — React's onWheel is passive.
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
      if (e.key === "Escape") {
        close();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(BUTTON_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / BUTTON_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, zoomBy, reset]);

  const pointerDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      lastPoint.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    } else if (pointers.current.size === 2) {
      pinchRef.current = { distance: pointerDistance(), zoom: view.zoom };
      setDragging(false);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchRef.current) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const [a, b] = [...pointers.current.values()];
      const ratio = pointerDistance() / (pinchRef.current.distance || 1);
      zoomToAbsolute(pinchRef.current.zoom * ratio, {
        x: (a.x + b.x) / 2 - rect.left,
        y: (a.y + b.y) / 2 - rect.top,
      });
      return;
    }

    if (!dragging || !lastPoint.current) return;
    const dx = e.clientX - lastPoint.current.x;
    const dy = e.clientY - lastPoint.current.y;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    setView((prev) => ({ ...prev, ...clampPan(prev.x + dx, prev.y + dy, prev.zoom) }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      setDragging(false);
      lastPoint.current = null;
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (view.zoom > 1.01) reset();
    else zoomToAbsolute(Math.min(2, maxZoom), anchor);
  };

  // Minimap viewport rectangle, per the README's geometry.
  const mini = useMemo(() => {
    if (base.w <= 0) return { left: "0%", top: "0%", width: "100%", height: "100%" };
    const scaledW = base.w * view.zoom;
    const scaledH = base.h * view.zoom;
    const fw = Math.min(1, canvas.w / scaledW);
    const fh = Math.min(1, canvas.h / scaledH);
    return {
      width: `${(fw * 100).toFixed(1)}%`,
      height: `${(fh * 100).toFixed(1)}%`,
      left: `${(50 - fw * 50 - (view.x / scaledW) * 100).toFixed(1)}%`,
      top: `${(50 - fh * 50 - (view.y / scaledH) * 100).toFixed(1)}%`,
    };
  }, [base.w, base.h, view, canvas.w, canvas.h]);

  const onMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    setView((prev) => ({
      ...prev,
      ...clampPan(
        -(fx - 0.5) * base.w * prev.zoom,
        -(fy - 0.5) * base.h * prev.zoom,
        prev.zoom,
      ),
    }));
  };

  const megapixels = (props.masterWidth * props.masterHeight) / 1_000_000;
  const dimensionLine = [
    props.masterWidth && props.masterHeight
      ? `${props.masterWidth} × ${props.masterHeight}`
      : null,
    props.arcsecPerPx ? `${props.arcsecPerPx.toFixed(2)}″/px` : null,
    megapixels > 0 ? `${megapixels.toFixed(1)} MP` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ready = base.w > 0 && source !== null;

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>{props.title}</span>
          <span className={styles.dimensions}>{dimensionLine}</span>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.control} ${styles.stepper}`}
            onClick={() => zoomBy(1 / BUTTON_STEP)}
            disabled={view.zoom <= 1}
            aria-label="Zoom out"
          >
            –
          </button>
          <span className={`${styles.control} ${styles.readout}`} aria-live="polite">
            {Math.round(view.zoom * 100)}%
          </span>
          <button
            type="button"
            className={`${styles.control} ${styles.stepper}`}
            onClick={() => zoomBy(BUTTON_STEP)}
            disabled={view.zoom >= maxZoom - 0.001}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.wordButton}`}
            onClick={reset}
          >
            Fit
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.wordButton} ${
              annotationsOn ? styles.annotationsOn : ""
            }`}
            onClick={toggleAnnotations}
            aria-pressed={annotationsOn}
          >
            Annotations
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.wordButton}`}
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className={`${styles.canvas} ${dragging ? styles.canvasDragging : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <div className={styles.centerBox}>
          <div
            className={styles.transformWrap}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              width: ready ? base.w : undefined,
              height: ready ? base.h : undefined,
              opacity: ready ? 1 : 0,
            }}
          >
            {source ? (
              <img
                className={styles.image}
                src={source.src}
                alt={props.alt}
                draggable={false}
                style={{ width: "100%", height: "100%" }}
              />
            ) : null}

            {annotationsOn && props.annotations.length > 0 ? (
              <div className={styles.annotationLayer}>
                {props.annotations.map((a) => (
                  <span
                    key={a.id}
                    className={styles.marker}
                    style={{ left: `${a.xPct}%`, top: `${a.yPct}%` }}
                  >
                    {/* The circle scales with the image so it keeps enclosing the
                        same patch of sky; only the label is counter-scaled, so
                        8px type stays 8px at any zoom. */}
                    <span
                      className={styles.markerCircle}
                      style={{ width: a.radiusPx, height: a.radiusPx }}
                    />
                    <span
                      className={styles.markerLabel}
                      style={{ transform: `scale(${1 / view.zoom})` }}
                    >
                      {a.label}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.overlayChips}>
          <span className={styles.overlayChip}>{props.chipLabel}</span>
          <span className={`${styles.overlayChip} ${styles.hintChip}`}>
            Scroll to zoom · drag to pan
          </span>
        </div>

        {source ? (
          <div className={styles.minimap} onClick={onMinimapClick}>
            <div className={styles.minimapInner}>
              <img className={styles.minimapImage} src={source.src} alt="" aria-hidden="true" />
              <span className={styles.minimapRect} style={mini} />
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.bottomBar}>
        <span className={styles.bottomMeta}>{props.metaLine}</span>
        <div className={styles.bottomActions}>
          {props.downloadHref ? (
            <a className={styles.bottomChip} href={props.downloadHref} download>
              Download 2048px
            </a>
          ) : null}
          <a className={styles.bottomChip} href={props.contactHref || "/about"}>
            Print enquiry
          </a>
        </div>
      </div>
    </div>
  );
}
