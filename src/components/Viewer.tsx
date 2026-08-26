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
  const [interacting, setInteracting] = useState(false);
  /** 1 during SSR and the first paint — `window` does not exist there. */
  const [dpr, setDpr] = useState(1);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * `will-change: transform` is a hint that a change is imminent, not a
   * permanent decoration. Held permanently it keeps this subtree on its own
   * compositing layer, and Chrome scales that layer's existing texture on zoom
   * rather than re-rasterising — so the image sits soft until something else
   * invalidates the layer (toggling annotations did exactly that, which is why
   * the picture appeared to sharpen on the first toggle).
   *
   * Raising it per gesture and dropping it once the gesture settles keeps pan
   * and zoom smooth, then hands the frame back to the normal paint path so it
   * re-rasterises crisply at whatever scale it landed on.
   */
  const beginInteraction = useCallback(() => {
    setInteracting(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setInteracting(false), 220);
  }, []);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const source = props.image.jpeg ?? props.image.webp ?? null;
  const aspect = source && source.height > 0 ? source.width / source.height : 1.71;

  // Measure the canvas so geometry uses real numbers rather than the
  // prototype's hardcoded 1600 / 760 / 1.71.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    // Seed from a synchronous measurement rather than waiting on the observer:
    // Chrome does not deliver ResizeObserver callbacks while the document is
    // hidden, so a viewer opened in a background tab would otherwise sit blank
    // until it was focused.
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCanvas({ w: rect.width, h: rect.height });
    }

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setCanvas({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Device pixel ratio is not a constant: dragging the window from a Retina
   * panel to a 1x monitor changes it live, and with it the zoom at which the
   * image is actually 1:1. There is no `devicepixelratio` event, so the idiom
   * is a media query pinned to the *current* ratio — it stops matching the
   * moment the ratio changes. Re-armed on every change, hence `[dpr]`; React
   * bails out when the value is unchanged, so this cannot loop.
   */
  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    read();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, [dpr]);

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

  /**
   * The zoom at which one image pixel covers exactly one *device* pixel.
   *
   * `base.w` is in CSS pixels, so dividing by it alone answers the wrong
   * question: on a devicePixelRatio-2 display, laying the image out at its own
   * pixel count in CSS px asks the browser to paint it across twice as many
   * device pixels, and the whole top of the zoom range is interpolation with no
   * new information in it. That is what made zooming look like zooming into a
   * JPEG. Everything below — the ceiling, the readout, the 1:1 control and the
   * interpolation switch — is expressed against this one value.
   */
  const nativeZoom = useMemo(() => {
    if (!source || base.w <= 0) return 1;
    return source.width / (base.w * dpr);
  }, [source, base.w, dpr]);

  /**
   * Never magnify past the pixels that actually exist. The 1.5 floor keeps the
   * zoom control usable in the corner case where the fit view already exceeds
   * native resolution (a very large window on a Retina display); the last of
   * that range is interpolated, and only there.
   */
  const maxZoom = useMemo(() => clamp(nativeZoom, 1.5, 8), [nativeZoom]);

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
      beginInteraction();
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
    [maxZoom, canvas.w, canvas.h, clampPan, beginInteraction],
  );

  const zoomToAbsolute = useCallback(
    (target: number, anchor?: { x: number; y: number }) => {
      beginInteraction();
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
      });
    },
    [maxZoom, canvas.w, canvas.h, clampPan, beginInteraction],
  );

  const reset = useCallback(() => {
    beginInteraction();
    setView(FIT);
  }, [beginInteraction]);
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
    beginInteraction();
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

  /**
   * Report the image that is actually on screen, not the master. Reading the
   * master's numbers while serving a smaller derivative overstated the frame by
   * a factor of two in megapixels — and the readout must not depend on the two
   * happening to match. When the master genuinely is larger, it gets its own
   * clause rather than borrowing the headline.
   */
  const shownWidth = source?.width ?? props.masterWidth;
  const shownHeight = source?.height ?? props.masterHeight;
  const megapixels = (shownWidth * shownHeight) / 1_000_000;
  const masterIsLarger = props.masterWidth > shownWidth * 1.02;
  const dimensionLine = [
    shownWidth && shownHeight ? `${shownWidth} × ${shownHeight}` : null,
    props.arcsecPerPx ? `${props.arcsecPerPx.toFixed(2)}″/px` : null,
    megapixels > 0 ? `${megapixels.toFixed(1)} MP` : null,
    masterIsLarger ? `master ${props.masterWidth} × ${props.masterHeight}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * Percentages are native-relative, not fit-relative: an astrophotographer
   * reads "100%" as 1:1, the way PixInsight and every other tool in the chain
   * labels it. Fit therefore reads as something like 38%.
   */
  const displayPct = Math.round((view.zoom / nativeZoom) * 100);
  const atNative = view.zoom >= nativeZoom - 0.001;

  const ready = base.w > 0 && source !== null;

  // Marker radii are authored against a nominal 1600px image width.
  const markerScale = base.w > 0 ? base.w / 1600 : 1;

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
          {/* Until the canvas is measured `nativeZoom` is a placeholder 1, which
              would render as "100%" — the one value that must never be wrong,
              since it is the claim that this is 1:1. */}
          <span className={`${styles.control} ${styles.readout}`} aria-live="polite">
            {ready ? `${displayPct}%` : "—"}
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
            className={`${styles.control} ${styles.wordButton} ${atNative ? styles.atNative : ""}`}
            onClick={() => zoomToAbsolute(nativeZoom)}
            aria-pressed={atNative}
            title="One image pixel per screen pixel"
          >
            1:1
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
              // Raised only for the duration of a gesture — see beginInteraction.
              willChange: interacting ? "transform" : "auto",
              width: ready ? base.w : undefined,
              height: ready ? base.h : undefined,
              opacity: ready ? 1 : 0,
            }}
          >
            {source ? (
              <img
                /* Past 1:1 there is no more information to interpolate, so
                   smoothing only blurs. Showing the pixels as pixels is what
                   PixInsight does and what the eye reads as "sharp". Below 1:1
                   smoothing is correct and stays on. */
                className={`${styles.image} ${view.zoom > nativeZoom ? styles.imagePixelated : ""}`}
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
                        8px type stays 8px at any zoom.

                        radiusPx is authored against a nominal 1600px-wide image
                        (the design's 22-54px range), so it is rescaled to the
                        actual fit width — otherwise the same marker would cover
                        a different area of sky on a different monitor. */}
                    <span
                      className={styles.markerCircle}
                      style={{
                        width: a.radiusPx * markerScale,
                        height: a.radiusPx * markerScale,
                      }}
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
