"use client";

import type { RowValue } from "./RowEditor";
import styles from "./AnnotationPreview.module.css";

type PreviewMarker = {
  label: string;
  xPct: number;
  yPct: number;
  radiusPx: number;
};

function markerFromRow(row: RowValue): PreviewMarker | null {
  const marker = {
    label: String(row.label ?? ""),
    xPct: Number(row.xPct),
    yPct: Number(row.yPct),
    radiusPx: Number(row.radiusPx),
  };
  return Number.isFinite(marker.xPct) &&
    Number.isFinite(marker.yPct) &&
    Number.isFinite(marker.radiusPx)
    ? marker
    : null;
}

export function AnnotationPreview({
  imageSrc,
  rows,
}: {
  imageSrc: string | null;
  rows: RowValue[];
}) {
  if (!imageSrc) {
    return <div className={styles.empty}>Upload an image to preview its markers.</div>;
  }

  const markers = rows.map(markerFromRow).filter((marker) => marker !== null);

  return (
    <figure className={styles.figure}>
      <div className={styles.imageWrap}>
        <img className={styles.image} src={imageSrc} alt="Frame annotation preview" />
        <div className={styles.layer}>
          {markers.map((marker, index) => (
            <span
              className={styles.marker}
              style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%` }}
              key={`${index}-${marker.label}`}
            >
              <span
                className={styles.circle}
                style={{ width: `${Math.max(0, marker.radiusPx) / 16}%` }}
              />
              <span className={styles.markerLabel}>{marker.label || "Unlabelled"}</span>
            </span>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        Published overlay preview · {markers.length} marker{markers.length === 1 ? "" : "s"}
      </figcaption>
    </figure>
  );
}
