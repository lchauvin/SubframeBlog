"use client";

import { useState } from "react";

import type { FilterBar } from "@/lib/format";
import styles from "./AcquisitionPanel.module.css";

export type NightRow = {
  id: number;
  date: string;
  filterLabel: string;
  sub: string;
  kept: number;
  rejected: number;
  reason: string;
};

export function AcquisitionPanel({
  bars,
  nights,
}: {
  bars: FilterBar[];
  nights: NightRow[];
}) {
  const [expanded, setExpanded] = useState(false);

  // With the night log optional, a frame may legitimately have no rows — in
  // which case the disclosure has nothing to disclose and is not rendered.
  const hasLog = nights.length > 0;

  return (
    <section>
      <div className={styles.headerRow}>
        <h2 className={styles.label}>Per-filter integration</h2>
        {hasLog ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls="frame-log"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide frame log" : "Show frame-by-frame log"}
          </button>
        ) : null}
      </div>

      {bars.length === 0 ? (
        <p className={styles.emptyBars}>No filter data recorded.</p>
      ) : (
        <>
          {bars.map((bar) => (
            <div className={styles.barRow} key={bar.name}>
              <div className={styles.filterName}>{bar.name}</div>
              <div
                className={styles.track}
                role="img"
                aria-label={`${bar.name}: ${bar.keptLabel} kept of ${bar.totalFrames} frames, ${bar.totalFrames - bar.keptFrames} rejected`}
              >
                <span className={styles.kept} style={{ width: bar.keptWidth }} />
                <span className={styles.rejected} style={{ width: bar.rejectedWidth }} />
              </div>
              <div className={styles.hours}>{bar.keptLabel}</div>
            </div>
          ))}

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchKept}`} />
              Kept
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchRejected}`} />
              Rejected at integration
            </span>
          </div>
        </>
      )}

      {hasLog && expanded ? (
        <table className={styles.table} id="frame-log">
          <thead>
            <tr>
              <th scope="col">Night</th>
              <th scope="col">Filter</th>
              <th scope="col" className={styles.right}>Sub</th>
              <th scope="col" className={styles.right}>Kept</th>
              <th scope="col" className={styles.right}>Rej.</th>
              <th scope="col" className={styles.right}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {nights.map((n) => (
              <tr key={n.id}>
                <td>{n.date}</td>
                <td className={styles.colFilter}>{n.filterLabel}</td>
                <td className={`${styles.right} ${styles.colSub}`}>{n.sub}</td>
                <td className={styles.right}>{n.kept}</td>
                <td className={`${styles.right} ${styles.colRej}`}>{n.rejected}</td>
                <td className={`${styles.right} ${styles.colReason}`}>{n.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
