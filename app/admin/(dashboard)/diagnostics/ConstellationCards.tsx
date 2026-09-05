"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  generateConstellationCardsAction,
  type ConstellationCardsRun,
  type ConstellationCardStatus,
} from "../../actions";

import styles from "../../admin.module.css";

type Props = { status: ConstellationCardStatus; width: number; height: number };

/**
 * Builds every published frame's constellation card in one click.
 *
 * No per-frame loop, unlike the media re-derive above it: a card is a small SVG
 * rasterised once, so the whole log finishes inside a single request. The
 * button is the only way to make these on a server without a terminal, since
 * the npm script needs `tsx` — and since the articles now show the cards, that
 * matters: a frame published on the server would otherwise never get one.
 */
export function ConstellationCards({ status, width, height }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ConstellationCardsRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (running) return;
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      setRun(await generateConstellationCardsAction());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run failed. Check the server log.");
    } finally {
      // In a finally so a thrown action cannot strand the button disabled.
      setRunning(false);
      router.refresh();
    }
  }

  const failed = run ? run.results.filter((r) => !r.ok) : [];

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Constellation cards</h2>
      <p className={styles.hint}>
        Two PNGs per published target, white on a transparent ground:
        <code>&lt;slug&gt;.png</code> is the constellation and the red target marker, and
        <code>&lt;slug&gt;-grid.png</code> is the RA/Dec ruling on its own. The article
        stacks them; the figure stays clean for use elsewhere. Nothing rebuilds them when
        an image is uploaded, so re-run after publishing a frame or after editing a
        frame&rsquo;s constellation or coordinates — until then a new frame&rsquo;s article
        simply shows no card.
      </p>

      <div className={styles.list}>
        <div className={styles.listRow} style={{ gridTemplateColumns: "220px 1fr" }}>
          <span className={styles.label}>Written to</span>
          <span className={`${styles.listMeta} ${styles.mono}`}>{status.outDir}</span>
        </div>
        <div className={styles.listRow} style={{ gridTemplateColumns: "220px 1fr" }}>
          <span className={styles.label}>Cards on disk</span>
          <span className={styles.listMeta}>
            {`${status.present} of ${status.frames} published target` +
              (status.frames === 1 ? "" : "s") +
              (status.missing.length > 0 ? ` · missing: ${status.missing.join(", ")}` : "")}
          </span>
        </div>
        <div className={styles.listRow} style={{ gridTemplateColumns: "220px 1fr" }}>
          <span className={styles.label}>Size</span>
          <span className={styles.listMeta}>
            {`${width} × ${height}, transparent, two layers each`}
          </span>
        </div>
      </div>

      {status.orphaned.length > 0 ? (
        <p className={styles.hint}>
          {status.orphaned.length} card{status.orphaned.length === 1 ? "" : "s"} no longer match
          a published frame ({status.orphaned.join(", ")}). They are left alone rather than
          deleted — remove them by hand if you no longer want them.
        </p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={running || status.frames === 0}
          onClick={generate}
        >
          {running
            ? "Generating…"
            : `Generate cards for all ${status.frames} target${status.frames === 1 ? "" : "s"}`}
        </button>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {run && !run.labelled ? (
        <div className={styles.error}>
          The grid was drawn without its hour and degree labels: the bundled label font
          was not found in this deployment. The cards are otherwise complete. Check that
          <code> assets/fonts </code> shipped with the build, then run this again.
        </div>
      ) : null}

      {run ? (
        <div className={styles.list}>
          {run.results.map((r) => (
            <div
              className={styles.listRow}
              style={{ gridTemplateColumns: "180px 1fr" }}
              key={r.slug}
            >
              <span className={styles.label}>{r.catalogId}</span>
              <span className={styles.listMeta}>
                {r.ok
                  ? `${r.constellation}` +
                    (r.matchedByName ? "" : " (nearest figure — check the plate)") +
                    ` · position from ${r.positionSource}`
                  : r.message}
              </span>
            </div>
          ))}
          <div className={styles.listRow} style={{ gridTemplateColumns: "180px 1fr" }}>
            <span className={styles.label}>Done</span>
            <span className={styles.listMeta}>
              {`${run.written} card${run.written === 1 ? "" : "s"} written` +
                (failed.length > 0 ? `, ${failed.length} skipped` : "")}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
