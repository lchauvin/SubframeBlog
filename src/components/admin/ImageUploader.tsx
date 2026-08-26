"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./ImageUploader.module.css";

export type VariantSummary = {
  variant: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
};

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Uploads to the /admin/upload route handler rather than through a server
 * action — masters are far larger than the action body limit.
 */
export function ImageUploader({
  frameId,
  previewSrc,
  variants,
}: {
  frameId: number;
  previewSrc: string | null;
  variants: VariantSummary[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ ok: false, text: "Choose a file first." });
      return;
    }

    setBusy(true);
    setMessage({ ok: true, text: `Uploading and deriving from ${file.name}…` });

    try {
      const body = new FormData();
      body.set("frameId", String(frameId));
      /**
       * The size the browser believes it is sending, so the server can tell a
       * short upload from a short file.
       *
       * Set *before* the file, deliberately: multipart parts arrive in append
       * order, so a field written after the file is the first thing lost when
       * the body is truncated — which is exactly the case it exists to detect.
       */
      body.set("declaredSize", String(file.size));
      body.set("file", file);

      const res = await fetch("/admin/upload", { method: "POST", body });
      const json = await res.json();

      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? `Upload failed (${res.status}).` });
      } else {
        setMessage({
          ok: true,
          text:
            `Done — master ${json.width}×${json.height}, ${json.derivatives} derivatives written.` +
            (json.solving ? " Plate solve started; see Viewer annotations below." : ""),
        });
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.preview}>
        {previewSrc ? (
          <img className={styles.previewImage} src={previewSrc} alt="Current frame" />
        ) : (
          <div className={styles.placeholder}>No image</div>
        )}
      </div>

      <div className={styles.side}>
        {variants.length > 0 ? (
          <div className={styles.variants}>
            {variants.map((v) => (
              <div className={styles.variantRow} key={`${v.variant}-${v.format}`}>
                <span className={styles.variantName}>
                  {v.variant} · {v.format}
                </span>
                <span>
                  {v.width} × {v.height}
                </span>
                <span>{kb(v.bytes)}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className={styles.controls}>
          <input
            ref={inputRef}
            type="file"
            className={styles.file}
            accept="image/jpeg,image/png,image/tiff,image/webp"
            disabled={busy}
          />
          <button type="button" className={styles.button} onClick={upload} disabled={busy}>
            {busy ? "Working…" : "Upload & derive"}
          </button>
        </div>

        {message ? (
          <div
            className={`${styles.status} ${message.ok ? styles.statusOk : styles.statusError}`}
            role="status"
          >
            {message.text}
          </div>
        ) : null}

        <p className={styles.note}>
          Uploading replaces every derivative for this frame. Save the form first — the
          upload uses the frame&rsquo;s saved slug for its folder name.
        </p>
      </div>
    </div>
  );
}
