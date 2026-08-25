"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AtlasFrameRef, AtlasPanel } from "@/server/atlas/build";
import { FrameImage } from "./FrameImage";
import { RegistrationMarks } from "./RegistrationMarks";
import styles from "./AtlasChart.module.css";

const CARD_WIDTH = 260;
/** Long enough to cross the gap from a footprint to its card without a flicker. */
const CARD_CLOSE_DELAY = 120;

type CardState = {
  key: string;
  label: string;
  frames: AtlasFrameRef[];
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
};

export function AtlasChart({ panels }: { panels: AtlasPanel[] }) {
  const [card, setCard] = useState<CardState | null>(null);
  // The card is a pointer affordance; on touch the tap should just navigate.
  const [pointerFine, setPointerFine] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPointerFine(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setCard(null), CARD_CLOSE_DELAY);
  }, [cancelClose]);

  /**
   * Anchors the card off the hovered shape's own box rather than the cursor, so
   * keyboard focus opens it in the same place a mouse would.
   */
  const open = useCallback(
    (key: string, label: string, frames: AtlasFrameRef[]) =>
      (event: React.MouseEvent | React.FocusEvent) => {
        if (!pointerFine) return;
        cancelClose();

        const shape = event.currentTarget as SVGGraphicsElement;
        const host = shape.closest(`.${styles.frame}`) as HTMLElement | null;
        if (!host) return;

        const shapeRect = shape.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const x = shapeRect.left - hostRect.left + shapeRect.width / 2;
        const y = shapeRect.top - hostRect.top;

        setCard({
          key,
          label,
          frames,
          x,
          y,
          flipX: x + CARD_WIDTH / 2 + 16 > hostRect.width,
          flipY: y < hostRect.height * 0.45,
        });
      },
    [cancelClose, pointerFine],
  );

  return (
    <div className={styles.panels}>
      {panels.map((panel) => (
        <figure className={styles.panel} key={panel.id}>
          <figcaption className={styles.caption}>
            <span className={styles.panelTitle}>{panel.title}</span>
            <span className={styles.panelMeta}>
              {panel.frameCount} {panel.frameCount === 1 ? "frame" : "frames"} · {panel.centreLabel}{" "}
              · {panel.spanLabel}
            </span>
          </figcaption>

          <div className={styles.frame}>
            <RegistrationMarks />
            <div className={styles.scroll}>
              <svg
                viewBox={`0 0 ${panel.width} ${panel.height}`}
                className={styles.svg}
                role="group"
                aria-label={`${panel.title} — ${panel.frameCount} frames`}
              >
                <defs>
                  <clipPath id={`${panel.id}-clip`}>
                    <rect x="0" y="0" width={panel.width} height={panel.height} />
                  </clipPath>
                </defs>

                {/* Stars, graticule and catalogue context are backdrop: drawn
                    first, clipped to the panel, and never interactive. */}
                <g clipPath={`url(#${panel.id}-clip)`} aria-hidden="true">
                  {/* Deepest layer, so the coordinate grid reads as an overlay
                      on the sky rather than the other way round. */}
                  <g className={styles.stars}>
                    {panel.stars.map((star) => (
                      <circle cx={star.x} cy={star.y} r={star.r} key={star.key} />
                    ))}
                  </g>

                  <g className={styles.starLabels}>
                    {panel.stars
                      .filter((star) => star.label)
                      .map((star) => (
                        <text x={star.x + star.r + 4} y={star.y + 3} key={`${star.key}-label`}>
                          {star.label}
                        </text>
                      ))}
                  </g>

                  <g className={styles.grid}>
                    {[...panel.graticule.ra, ...panel.graticule.dec].map((line) => (
                      <polyline points={line.points} key={line.key} />
                    ))}
                  </g>

                  <g className={styles.context}>
                    {panel.context.map((object) => (
                      <g key={object.key}>
                        <circle cx={object.x} cy={object.y} r={object.radius} />
                        <text x={object.x} y={object.y - object.radius - 5}>
                          {object.label}
                        </text>
                      </g>
                    ))}
                  </g>

                  <g className={styles.gridLabels}>
                    {[...panel.graticule.ra, ...panel.graticule.dec]
                      .filter((line) => line.hasLabel)
                      .map((line) => (
                        <text
                          x={line.labelX}
                          y={line.labelY}
                          key={`${line.key}-label`}
                          className={line.key.startsWith("ra") ? styles.raLabel : styles.decLabel}
                        >
                          {line.label}
                        </text>
                      ))}
                  </g>
                </g>

                {panel.footprints.map((footprint) => (
                  <a
                    href={`/frame/${footprint.frames[0].slug}`}
                    key={footprint.key}
                    className={styles.hit}
                    aria-label={ariaLabel(footprint.frames)}
                    onMouseEnter={open(footprint.key, footprint.label, footprint.frames)}
                    onFocus={open(footprint.key, footprint.label, footprint.frames)}
                    onMouseLeave={scheduleClose}
                    onBlur={scheduleClose}
                  >
                    <polygon points={footprint.points} className={styles.footprint} />
                    <text x={footprint.labelX} y={footprint.labelY} className={styles.shapeLabel}>
                      {footprint.label}
                      {footprint.frames.length > 1 ? (
                        <tspan dx="7" className={styles.chip}>
                          {footprint.frames.length} FRAMES
                        </tspan>
                      ) : null}
                    </text>
                  </a>
                ))}

                {panel.pins.map((pin) => (
                  <a
                    href={`/frame/${pin.frames[0].slug}`}
                    key={pin.key}
                    className={styles.hit}
                    aria-label={ariaLabel(pin.frames)}
                    onMouseEnter={open(pin.key, pin.label, pin.frames)}
                    onFocus={open(pin.key, pin.label, pin.frames)}
                    onMouseLeave={scheduleClose}
                    onBlur={scheduleClose}
                  >
                    <rect
                      x={pin.x}
                      y={pin.y}
                      width={pin.size}
                      height={pin.size}
                      className={styles.pin}
                    />
                    <text x={pin.x + pin.size / 2} y={pin.y - 7} className={styles.shapeLabel}>
                      {pin.label}
                      <tspan dx="7" className={styles.chip}>
                        NO SOLVE
                      </tspan>
                    </text>
                  </a>
                ))}

                <g className={styles.scaleBar} aria-hidden="true">
                  <line
                    x1={panel.scaleBar.x}
                    y1={panel.scaleBar.y}
                    x2={panel.scaleBar.x + panel.scaleBar.length}
                    y2={panel.scaleBar.y}
                  />
                  <line
                    x1={panel.scaleBar.x}
                    y1={panel.scaleBar.y - 4}
                    x2={panel.scaleBar.x}
                    y2={panel.scaleBar.y + 4}
                  />
                  <line
                    x1={panel.scaleBar.x + panel.scaleBar.length}
                    y1={panel.scaleBar.y - 4}
                    x2={panel.scaleBar.x + panel.scaleBar.length}
                    y2={panel.scaleBar.y + 4}
                  />
                  <text x={panel.scaleBar.x} y={panel.scaleBar.y - 9}>
                    {panel.scaleBar.label}
                  </text>
                </g>
              </svg>
            </div>

            {card && [...panel.footprints, ...panel.pins].some((d) => d.key === card.key) ? (
              <div
                className={styles.card}
                style={{
                  left: card.x,
                  top: card.y,
                  transform: `translate(${card.flipX ? "-92%" : "-50%"}, ${
                    card.flipY ? "12px" : "calc(-100% - 12px)"
                  })`,
                }}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                <div className={styles.cardMount}>
                  <FrameImage
                    images={card.frames[0].thumb}
                    alt={card.frames[0].catalogId}
                    className={styles.cardImage}
                    sizes="260px"
                  />
                </div>

                <div className={styles.cardKicker}>
                  {card.frames[0].dateLabel} · {card.frames[0].palette}
                </div>
                <div className={styles.cardTitle}>{card.frames[0].catalogId}</div>
                {card.frames[0].commonName ? (
                  <div className={styles.cardName}>{card.frames[0].commonName}</div>
                ) : null}

                {card.frames.length === 1 ? (
                  <div className={styles.cardMeta}>
                    {card.frames[0].integrationLabel} integration
                  </div>
                ) : (
                  <div className={styles.cardRows}>
                    {card.frames.map((frame) => (
                      <a href={`/frame/${frame.slug}`} className={styles.cardRow} key={frame.slug}>
                        <span>{frame.revision ? `Rev ${frame.revision}` : "Revision"}</span>
                        <span className={styles.cardRowMeta}>
                          {frame.dateLabel} · {frame.integrationLabel}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </figure>
      ))}
    </div>
  );
}

function ariaLabel(frames: AtlasFrameRef[]): string {
  const head = frames[0];
  const name = head.commonName ? `${head.catalogId} — ${head.commonName}` : head.catalogId;
  return frames.length > 1 ? `${name} (${frames.length} frames)` : name;
}
