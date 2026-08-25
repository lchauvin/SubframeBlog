"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RowValue } from "./RowEditor";

import styles from "./SolveStatus.module.css";

type Status = "none" | "queued" | "solving" | "solved" | "failed";

type Payload = {
  configured: boolean;
  status: Status;
  message: string;
  hintMode: string;
  submissionId: string;
  jobId: string;
  objectsFound: number;
  annotationsWritten: number;
  centerRa: number | null;
  centerDec: number | null;
  pixScale: number | null;
  orientation: number | null;
  updatedAt: string | null;
  annotations: RowValue[];
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
export function SolveStatus({
  frameId,
  onAnnotations,
}: {
  frameId: number;
  onAnnotations?: (annotations: RowValue[]) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachRef, setAttachRef] = useState("");
  const [attachKind, setAttachKind] = useState<"submission" | "job">("submission");
  const appliedSolve = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/solve?frameId=${frameId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as Payload;
      setData(json);

      // Apply each completed solve exactly once. Passing the rows directly
      // avoids leaving RowEditor's local state stale after a server refresh.
      const solveVersion = `${json.status}:${json.updatedAt ?? ""}`;
      if (json.status === "solved" && appliedSolve.current !== solveVersion) {
        appliedSolve.current = solveVersion;
        onAnnotations?.(json.annotations);
      }
    } catch {
      /* transient — the next tick will retry */
    }
  }, [frameId, onAnnotations]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = data?.status === "queued" || data?.status === "solving";

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [active, load]);

  async function post(body: Record<string, unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/admin/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? failure);
      else return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
    return false;
  }

  async function solveAgain() {
    if (await post({}, "Could not start a solve.")) await load();
  }

  async function attach() {
    if (!attachRef.trim()) return;
    // Reading a finished job is synchronous on the server, so by the time this
    // returns the markers are already written — reload rather than poll.
    if (await post({ attach: attachRef, attachKind }, "Could not read that solution.")) {
      setAttachOpen(false);
      setAttachRef("");
      await load();
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

  const submittedWith =
    data.hintMode === "blind"
      ? "Submitted blind — no position or scale hint."
      : data.hintMode === "attached"
        ? `Adopted from astrometry.net job ${data.jobId} — not solved here.`
        : "";

  return (
    <div className={panelClass}>
      <div className={styles.head}>
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
          {submittedWith ? <div className={styles.detail}>{submittedWith}</div> : null}

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

      <div className={styles.attach}>
        <button
          type="button"
          className={styles.attachToggle}
          onClick={() => setAttachOpen((open) => !open)}
        >
          {attachOpen ? "Cancel" : "Use a solve from astrometry.net"}
        </button>

        {attachOpen ? (
          <>
            <div className={styles.attachForm}>
              <input
                className={styles.attachInput}
                value={attachRef}
                onChange={(e) => setAttachRef(e.target.value)}
                // Enter inside the frame form would otherwise submit the frame.
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void attach();
                  }
                }}
                placeholder="nova.astrometry.net/status/13012345"
                spellCheck={false}
              />
              <select
                className={styles.attachSelect}
                value={attachKind}
                onChange={(e) => setAttachKind(e.target.value as "submission" | "job")}
                aria-label="What a bare id refers to"
              >
                <option value="submission">Submission</option>
                <option value="job">Job</option>
              </select>
              <button
                type="button"
                className={styles.button}
                onClick={attach}
                disabled={busy || !attachRef.trim()}
              >
                {busy ? "Reading…" : "Attach"}
              </button>
            </div>
            <div className={styles.detail}>
              Solve the frame&rsquo;s own export at nova.astrometry.net, then paste the link from
              its status or job page. The calibration, WCS and markers are read from that job — no
              upload, and no API key needed. The image solved there must have the same crop as this
              frame&rsquo;s master; its resolution can differ.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
