import fs from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";

import { isConfigured } from "@/server/astrometry/client";
import { getDb } from "@/server/db/client";
import { plateSolves } from "@/server/db/schema";
import { checkReadiness } from "@/server/health";
import { listMediaStatus } from "@/server/media/status";
import {
  DATA_ROOT,
  DB_PATH,
  MEDIA_ROOT,
  isDataRootInsideDeployTree,
} from "@/server/paths";

import { MediaRederive } from "./MediaRederive";

import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

async function fileSize(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

async function directoryUsage(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await directoryUsage(target);
        files += nested.files;
        bytes += nested.bytes;
      } else if (entry.isFile()) {
        files += 1;
        bytes += await fileSize(target);
      }
    }
  } catch {}
  return { files, bytes };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function DiagnosticsPage() {
  const [readiness, dbBytes, media, pending, mediaStatus] = await Promise.all([
    checkReadiness(),
    fileSize(DB_PATH),
    directoryUsage(MEDIA_ROOT),
    getDb()
      .select({ id: plateSolves.id })
      .from(plateSolves)
      .where(inArray(plateSolves.status, ["queued", "solving"])),
    listMediaStatus(),
  ]);

  const staleMedia = mediaStatus.filter((f) => f.stale).length;

  const rows = [
    ["Readiness", readiness.ok ? "Ready" : "Needs attention"],
    ["Data directory", DATA_ROOT],
    ["Inside deployment tree", isDataRootInsideDeployTree() ? "Yes — unsafe" : "No"],
    ["SQLite database", mb(dbBytes)],
    ["Media", `${media.files} files · ${mb(media.bytes)}`],
    ["Pending plate solves", String(pending.length)],
    [
      "Derivatives behind the pipeline",
      staleMedia === 0 ? "None" : `${staleMedia} of ${mediaStatus.length} frames`,
    ],
    ["Astrometry.net", isConfigured() ? "Configured" : "Not configured"],
  ];

  return (
    <>
      <h1 className={styles.pageTitle}>Diagnostics</h1>
      <p className={styles.pageSub}>Runtime storage, health and backup</p>

      {!readiness.ok || isDataRootInsideDeployTree() ? (
        <div className={styles.error}>
          Production storage is not ready. Check the values below before uploading real content.
        </div>
      ) : (
        <div className={styles.success}>All runtime readiness checks pass.</div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Runtime</h2>
        <div className={styles.list}>
          {rows.map(([label, value]) => (
            <div
              className={styles.listRow}
              style={{ gridTemplateColumns: "220px 1fr" }}
              key={label}
            >
              <span className={styles.label}>{label}</span>
              <span className={`${styles.listMeta} ${styles.mono}`}>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <MediaRederive frames={mediaStatus} />

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>SQLite snapshot</h2>
        <p className={styles.hint}>
          Download a consistent database snapshot. Images are not included; back up the media
          directory separately with Hostinger&rsquo;s File Manager or hosting backups.
        </p>
        <form action="/admin/backup" method="post" className={styles.actions}>
          <button type="submit" className={styles.buttonPrimary}>
            Download database backup
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Persistence launch test</h2>
        <p className={styles.hint}>
          Before launch, create a draft with an image, redeploy twice, and confirm that the draft,
          image derivatives and this data path remain unchanged.
        </p>
      </section>
    </>
  );
}
