import type { Metadata } from "next";
import Link from "next/link";

import { FrameImage } from "@/components/FrameImage";
import { RegistrationMarks } from "@/components/RegistrationMarks";
import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { formatMonthYear } from "@/lib/format";
import { shareMetadata, siteOrigin } from "@/lib/share-meta";
import {
  getLogSummary,
  getSiteSettings,
  listPublishedFrames,
  pickImage,
} from "@/server/db/queries";
import { useRequestTimeRendering } from "@/server/rendering";

import styles from "./gallery.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const [frames, settings, origin] = await Promise.all([
    listPublishedFrames(),
    getSiteSettings(),
    siteOrigin(),
  ]);
  const chrome = settings ?? DEFAULT_SITE_SETTINGS;
  return shareMetadata({
    title: chrome.logHeading,
    description: `${chrome.siteName} — ${chrome.siteTagline}`,
    images: frames[0]?.images,
    path: "/",
    origin,
    siteName: chrome.siteName,
  });
}

export default async function LogPage() {
  await useRequestTimeRendering();
  const [frames, summary, settings] = await Promise.all([
    listPublishedFrames(),
    getLogSummary(),
    getSiteSettings(),
  ]);

  const chrome = settings ?? DEFAULT_SITE_SETTINGS;

  // Computed from stored frame totals, replacing the prototype's hardcoded
  // "41 frames · 612h integration · 2021–2026".
  const range =
    summary.firstYear && summary.lastYear
      ? summary.firstYear === summary.lastYear
        ? `${summary.firstYear}`
        : `${summary.firstYear}–${summary.lastYear}`
      : null;

  const subhead = [
    `${summary.frameCount} ${summary.frameCount === 1 ? "frame" : "frames"}`,
    `${summary.totalHours}h integration`,
    range,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{chrome.logHeading}</h1>
      <p className={styles.subhead}>{subhead}</p>

      {frames.length === 0 ? (
        <div className={styles.empty}>
          No published frames yet. Run <code>npm run seed</code> to load the five design
          frames, or add one in <Link href="/admin">the admin</Link>.
        </div>
      ) : null}

      {frames.map((frame) => (
        <Link key={frame.id} href={`/frame/${frame.slug}`} className={styles.row}>
          <div className={styles.frame}>
            <RegistrationMarks />
            <FrameImage
              images={pickImage(frame.images, "article")}
              alt={`${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`}
              className={styles.image}
              sizes="(max-width: 900px) 100vw, 900px"
            />
          </div>

          <div className={styles.meta}>
            <div className={styles.kicker}>
              {formatMonthYear(frame.capturedOn)} · {frame.palette}
            </div>
            <h2 className={styles.targetId}>{frame.catalogId}</h2>
            <div className={styles.commonName}>{frame.commonName}</div>
            <p className={styles.blurb}>{frame.blurb}</p>
            <div className={styles.metaLine}>{frame.metaLine}</div>
            <span className={styles.cta}>Acquisition &amp; processing</span>
          </div>
        </Link>
      ))}

      {chrome.logPaginationLabel ? (
        <div className={styles.pagination}>
          {/* Pagination placeholder, exactly as designed. */}
          <span className={styles.paginationButton}>{chrome.logPaginationLabel}</span>
        </div>
      ) : null}
    </main>
  );
}
