"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./SolveStatus.module.css";

type Status = "none" | "queued" | "solving" | "solved" | "failed";

type Payload = {
  configured: boolean;
  status: Status;
  message: string;
  objectsFound: number;
  annotationsWritten: number;
  centerRa: number | null;
  centerDec: number | null;
  pixScale: number | null;
  orientation: number | null;
};

const LABELS: Record<Status, string> = {
  none: "Plate solve",
  queued: "Plate solve — queued",
  solving: "Plate solve — running",
  solved: "Plate solve — solved",
  failed: "Plate solve — failed",
};

/**
 * Shows the state of the frame's plate solve and lets it be re-run.
 *
 * Polls only while work is in flight; a solve on the public astrometry.net
 * queue takes anywhere from ~30s to a few minutes, so the upload cannot wait
 * for it and the result arrives here instead.
 */
export function SolveStatus({ frameId }: { frameId: number }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wasActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/solve?frameId=${frameId}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Payload;
      setData(json);

      // When a run finishes, pull the newly written annotation rows into the form.
      const active = json.status === "queued" || json.status === "solving";
      if (wasActive.current && !active) router.refresh();
      wasActive.current = active;
    } catch {
      /* transient — the next tick will retry */
    }
  }, [frameId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = data?.status === "queued" || data?.status === "solving";

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [active, load]);

  async function solveAgain() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/admin/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameId }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Could not start a solve.");
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a solve.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const status = data.status;
  const panelClass = active
    ? `${styles.panel} ${styles.panelActive}`
    : status === "failed"
      ? `${styles.panel} ${styles.panelFailed}`
      : styles.panel;

  const dotClass = active
    ? `${styles.dot} ${styles.dotActive}`
    : status === "solved"
      ? `${styles.dot} ${styles.dotSolved}`
      : status === "failed"
        ? `${styles.dot} ${styles.dotFailed}`
        : styles.dot;

  const calibration =
    status === "solved" && data.centerRa !== null && data.centerDec !== null
      ? `Centre ${data.centerRa.toFixed(4)}°, ${data.centerDec.toFixed(4)}°` +
        (data.pixScale ? ` · measured ${data.pixScale.toFixed(3)}″/px on the master` : "") +
        (data.orientation !== null ? ` · rotation ${data.orientation.toFixed(1)}°` : "")
      : "";

  return (
    <div className={panelClass}>
      <div className={styles.body}>
        <div className={styles.label}>
          <span className={dotClass} />
          {LABELS[status]}
        </div>

        <div className={styles.message}>
          {error ||
            data.message ||
            (!data.configured
              ? "Not configured — set ASTROMETRY_API_KEY to annotate frames automatically."
              : "No solve has been run for this frame yet.")}
        </div>

        {calibration ? <div className={styles.detail}>{calibration}</div> : null}

        {status === "solved" && data.annotationsWritten > 0 ? (
          <div className={styles.detail}>
            The last {data.annotationsWritten} marker
            {data.annotationsWritten === 1 ? "" : "s"} below came from this solve. Check the
            positions, delete any you don&rsquo;t want, then save — saving accepts them.
          </div>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={solveAgain}
          disabled={busy || active || !data.configured}
        >
          {active ? "Running…" : busy ? "Starting…" : "Solve again"}
        </button>
      </div>
    </div>
  );
}
