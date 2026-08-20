import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { AcquisitionPanel, type NightRow } from "@/components/AcquisitionPanel";
import { FrameImage } from "@/components/FrameImage";
import { PLATE_FIELDS } from "@/lib/defaults";
import {
  buildFilterBars,
  formatDayMonth,
  formatMinutes,
  formatMonthYear,
  toParagraphs,
} from "@/lib/format";
import { getCurrentAdmin } from "@/server/auth/session";
import {
  getAdjacentFrames,
  getFrameBySlug,
  getGearItems,
  pickImage,
} from "@/server/db/queries";

import styles from "./article.module.css";

/**
 * A static export has no request context, so drafts cannot be previewed there —
 * only published frames are emitted at all.
 */
const IS_EXPORT = process.env.ASTROBLOG_EXPORT === "1";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const frame = await getFrameBySlug(slug);
    if (!frame) return { title: "Not found" };
    return {
      title: `${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`,
      description: frame.blurb,
    };
  } catch (error) {
    console.error(`[astroblog] Metadata failed for frame "${slug}".`, error);
    throw error;
  }
}

async function renderArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const frame = await getFrameBySlug(slug);
  if (!frame) notFound();

  // Drafts stay invisible to the public but remain previewable while logged in.
  // The getCurrentAdmin() call reads cookies, which is why it must be skipped
  // when exporting — a static page has no request to read them from.
  if (!frame.published) {
    if (IS_EXPORT) notFound();
    if (!(await getCurrentAdmin())) notFound();
  }

  const [adjacent, gear] = await Promise.all([getAdjacentFrames(frame.id), getGearItems()]);

  const bars = buildFilterBars(frame.filters);
  const nightRows: NightRow[] = frame.nights.map((n) => ({
    id: n.id,
    date: formatDayMonth(n.nightDate),
    filterLabel: n.filterLabel,
    sub: n.subLengthSeconds ? `${n.subLengthSeconds}s` : "—",
    kept: n.kept,
    rejected: n.rejected,
    reason: n.reason || "—",
  }));

  const chips = [
    [frame.palette, frame.bandwidth].filter(Boolean).join(" · "),
    frame.opticsLabel,
    [frame.sensorLabel, frame.arcsecPerPx ? `${frame.arcsecPerPx.toFixed(2)}″/px` : null]
      .filter(Boolean)
      .join(" · "),
  ].filter(Boolean);

  const plateValues = PLATE_FIELDS.map((f) => ({
    label: f.label,
    value: frame[f.key] || "—",
  }));

  const viewerImages = pickImage(frame.images, "article");

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        <ChevronLeft size={13} strokeWidth={1.5} />
        Back to the log
      </Link>

      <div className={styles.plate}>
        <div className={`${styles.cell} ${styles.cellTarget}`}>
          <div className={styles.cellLabel}>Target</div>
          <h1 className={styles.targetName}>
            {frame.catalogId}
            {frame.commonName ? ` — ${frame.commonName}` : ""}
          </h1>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellLabel}>Frame / Rev</div>
          <div className={styles.cellMono}>
            {frame.frameNumber}
            {frame.revision ? ` / ${frame.revision}` : ""}
          </div>
        </div>

        <div className={`${styles.cell} ${styles.cellLast}`}>
          <div className={styles.cellLabel}>Integration</div>
          <div className={styles.cellMonoAccent}>
            {formatMinutes(frame.totalIntegrationMinutes)}
          </div>
        </div>

        <div className={styles.imageBand}>
          <FrameImage
            images={viewerImages}
            alt={`${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`}
            className={styles.image}
            sizes="(max-width: 1040px) 100vw, 1246px"
            priority
          />
          {chips.length > 0 ? (
            <div className={styles.chips}>
              {chips.map((c) => (
                <span className={styles.chip} key={c}>
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <Link href={`/frame/${frame.slug}/full`} className={styles.zoomButton}>
            Zoom 1:1
          </Link>
        </div>

        {plateValues.map((p, i) => (
          <div
            className={`${styles.specCell} ${i % 4 === 3 ? styles.cellLast : ""}`}
            key={p.label}
          >
            <div className={styles.specLabel}>{p.label}</div>
            <div className={styles.specValue}>{p.value}</div>
          </div>
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.narrative}>
          <h2 className={styles.h2}>Target &amp; processing</h2>
          {toParagraphs(frame.bodyMarkdown).map((p, i) => (
            <p className={styles.prose} key={i}>
              {p}
            </p>
          ))}
          {frame.note ? (
            <div className={styles.note}>
              <div className={styles.noteLabel}>Note to self</div>
              <p className={styles.noteBody}>{frame.note}</p>
            </div>
          ) : null}
        </div>

        <div className={styles.data}>
          <AcquisitionPanel bars={bars} nights={nightRows} />

          {gear.length > 0 ? (
            <>
              <div className={styles.equipmentLabel}>Equipment</div>
              {gear.map((g) => (
                <div className={styles.equipmentRow} key={g.id}>
                  <div className={styles.equipmentKey}>{g.keyLabel}</div>
                  <div className={styles.equipmentValue}>{g.value}</div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      {adjacent.length > 0 ? (
        <section className={styles.adjacent}>
          <div className={styles.adjacentLabel}>Adjacent frames</div>
          <div className={styles.thumbGrid}>
            {adjacent.map((a) => (
              <Link href={`/frame/${a.slug}`} className={styles.thumb} key={a.id}>
                <div className={styles.thumbFrame}>
                  <FrameImage
                    images={pickImage(a.images, "thumb")}
                    alt={a.catalogId}
                    className={styles.thumbImage}
                    sizes="(max-width: 1040px) 50vw, 300px"
                  />
                </div>
                <div className={styles.thumbId}>{a.catalogId}</div>
                <div className={styles.thumbMeta}>
                  {formatMonthYear(a.capturedOn)} · {formatMinutes(a.totalIntegrationMinutes)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default async function ArticlePage(props: {
  params: Promise<{ slug: string }>;
}) {
  try {
    return await renderArticlePage(props);
  } catch (error) {
    let slug = "<unresolved>";
    try {
      slug = (await props.params).slug;
    } catch {}
    console.error(`[astroblog] Article render failed for frame "${slug}".`, error);
    throw error;
  }
}
