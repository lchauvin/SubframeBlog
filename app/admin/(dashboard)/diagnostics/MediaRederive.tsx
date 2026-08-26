"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { rederiveFrameAction, type RederiveResult } from "../../actions";
import type { MediaStatus } from "@/server/media/status";

import styles from "../../admin.module.css";

type Props = { frames: MediaStatus[] };

/**
 * Runs the re-derive one frame at a time, from the browser.
 *
 * The loop lives here rather than in the action because each frame is a few
 * seconds of sharp on shared CPU: a server-side loop over sixteen frames is one
 * long request that can time out with nothing to show for it, while this shows
 * progress per frame and can be stopped or resumed at any point. Every frame is
 * independently idempotent, so a run that stops halfway simply leaves the rest
 * still marked stale.
 */
export function MediaRederive({ frames }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<RederiveResult[]>([]);

  const rebuildable = frames.filter((f) => f.hasMaster);
  const stale = rebuildable.filter((f) => f.stale);
  const missingMaster = frames.filter((f) => !f.hasMaster);

  async function run(targets: MediaStatus[]) {
    if (targets.length === 0) return;
    setRunning(true);
    setStopRequested(false);
    setResults([]);

    let stopped = false;
    for (const frame of targets) {
      // Read through a setter so the flag set by a click mid-run is seen.
      let shouldStop = false;
      setStopRequested((v) => {
        shouldStop = v;
        return v;
      });
      if (shouldStop) {
        stopped = true;
        break;
      }

      setCurrent(frame.slug);
      const result = await rederiveFrameAction(frame.frameId);
      setResults((prev) => [...prev, result]);
    }

    setCurrent(null);
    setRunning(false);
    if (stopped) setStopRequested(false);
    // Pull fresh status so the staleness list reflects what just happened.
    router.refresh();
  }

  const failed = results.filter((r) => !r.ok).length;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Image derivatives</h2>
      <p className={styles.hint}>
        Derivatives are only generated when a master is uploaded, so a change to the image
        pipeline does not reach frames already stored. This rebuilds them from the masters
        already on this server — nothing needs re-uploading. One frame per request, so a slow
        rebuild cannot time out mid-run; you can stop and resume at any point.
      </p>

      {stale.length === 0 && missingMaster.length === 0 ? (
        <div className={styles.success}>
          All {frames.length} frame{frames.length === 1 ? "" : "s"} match the current pipeline.
        </div>
      ) : null}

      {stale.length > 0 ? (
        <div className={styles.list}>
          {stale.map((f) => (
            <div
              className={styles.listRow}
              style={{ gridTemplateColumns: "180px 1fr auto" }}
              key={f.slug}
            >
              <span className={styles.label}>{f.catalogId}</span>
              <span className={styles.listMeta}>{f.reasons.join(" · ")}</span>
              <button
                type="button"
                className={styles.button}
                disabled={running}
                onClick={() => run([f])}
              >
                {current === f.slug ? "Rebuilding…" : "Rebuild"}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {missingMaster.length > 0 ? (
        <div className={styles.error}>
          {missingMaster.length} frame{missingMaster.length === 1 ? "" : "s"} cannot be rebuilt —
          the master is missing on disk ({missingMaster.map((f) => f.slug).join(", ")}). Only a
          fresh upload can restore those.
        </div>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={running || stale.length === 0}
          onClick={() => run(stale)}
        >
          {running
            ? `Rebuilding ${results.length + 1} of ${stale.length}…`
            : `Rebuild ${stale.length} stale frame${stale.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={running || rebuildable.length === 0}
          onClick={() => run(rebuildable)}
        >
          Rebuild all {rebuildable.length}
        </button>
        {running ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => setStopRequested(true)}
            disabled={stopRequested}
          >
            {stopRequested ? "Stopping after this frame…" : "Stop"}
          </button>
        ) : null}
      </div>

      {results.length > 0 ? (
        <div className={styles.list}>
          {results.map((r, i) => (
            <div
              className={styles.listRow}
              style={{ gridTemplateColumns: "180px 1fr" }}
              key={`${r.slug}-${i}`}
            >
              <span className={styles.label}>{r.slug}</span>
              <span className={styles.listMeta}>
                {r.ok
                  ? `${r.derivatives} derivatives` +
                    (r.viewerLongEdge ? ` · viewer ${r.viewerLongEdge}px` : "") +
                    (r.tileCount ? ` · ${r.tileCount} tiles` : " · no tiles")
                  : r.message}
              </span>
            </div>
          ))}
          {!running ? (
            <div className={styles.listRow} style={{ gridTemplateColumns: "180px 1fr" }}>
              <span className={styles.label}>Done</span>
              <span className={styles.listMeta}>
                {results.length - failed} rebuilt
                {failed > 0 ? `, ${failed} failed — see the server log` : ""}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
