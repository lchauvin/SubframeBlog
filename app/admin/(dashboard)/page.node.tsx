import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

import { formatMinutes, formatMonthYear } from "@/lib/format";
import { listAllFrames, pickImage } from "@/server/db/queries";

import { moveFrame, togglePublish } from "../actions";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminFramesPage() {
  const frames = await listAllFrames();
  const published = frames.filter((f) => f.published).length;

  return (
    <>
      <h1 className={styles.pageTitle}>Frames</h1>
      <p className={styles.pageSub}>
        {frames.length} total · {published} published · {frames.length - published} draft
      </p>

      <div className={styles.actions} style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
        <Link href="/admin/frames/new" className={styles.buttonPrimary}>
          New frame
        </Link>
      </div>

      {frames.length === 0 ? (
        <div className={styles.empty} style={{ marginTop: 20 }}>
          No frames yet. Create one above, or run <code>npm run seed</code> to load the five
          design frames.
        </div>
      ) : (
        <div className={styles.list} style={{ marginTop: 22 }}>
          {frames.map((frame, index) => {
            const thumb = pickImage(frame.images, "thumb");
            const src = thumb.jpeg?.src ?? thumb.webp?.src ?? null;

            return (
              <div className={styles.listRow} key={frame.id}>
                <div className={styles.orderButtons}>
                  <form action={moveFrame}>
                    <input type="hidden" name="id" value={frame.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      className={`${styles.button} ${styles.iconButton}`}
                      disabled={index === 0}
                      aria-label={`Move ${frame.catalogId} up`}
                    >
                      <ChevronUp size={14} strokeWidth={2} />
                    </button>
                  </form>
                  <form action={moveFrame}>
                    <input type="hidden" name="id" value={frame.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      className={`${styles.button} ${styles.iconButton}`}
                      disabled={index === frames.length - 1}
                      aria-label={`Move ${frame.catalogId} down`}
                    >
                      <ChevronDown size={14} strokeWidth={2} />
                    </button>
                  </form>
                </div>

                {src ? (
                  <img className={styles.listThumb} src={src} alt="" />
                ) : (
                  <span className={styles.listThumb} />
                )}

                <div>
                  <div className={styles.listTitle}>
                    {frame.catalogId}
                    {frame.commonName ? ` — ${frame.commonName}` : ""}
                  </div>
                  <div className={styles.listSlug}>/frame/{frame.slug}</div>
                </div>

                <div className={styles.listMeta}>{formatMonthYear(frame.capturedOn)}</div>
                <div className={styles.listMeta}>
                  {formatMinutes(frame.totalIntegrationMinutes)}
                </div>

                <div>
                  <span
                    className={`${styles.badge} ${frame.published ? styles.badgePublished : ""}`}
                  >
                    {frame.published ? "Published" : "Draft"}
                  </span>
                </div>

                <div className={styles.rowActions}>
                  <form action={togglePublish}>
                    <input type="hidden" name="id" value={frame.id} />
                    <button type="submit" className={styles.button}>
                      {frame.published ? "Unpublish" : "Publish"}
                    </button>
                  </form>
                  <Link href={`/admin/frames/${frame.id}`} className={styles.button}>
                    Edit
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
