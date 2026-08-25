import type { Metadata } from "next";
import Link from "next/link";

import { AtlasChart } from "@/components/AtlasChart";
import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { shareMetadata, siteOrigin } from "@/lib/share-meta";
import { buildAtlas } from "@/server/atlas/build";
import { getSiteSettings, listAtlasFrames } from "@/server/db/queries";
import { useRequestTimeRendering } from "@/server/rendering";

import styles from "./sky.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const [frames, settings, origin] = await Promise.all([
    listAtlasFrames(),
    getSiteSettings(),
    siteOrigin(),
  ]);
  const chrome = settings ?? DEFAULT_SITE_SETTINGS;
  return shareMetadata({
    title: chrome.skyHeading,
    description: `Where every frame sits on the sky — ${chrome.siteName}`,
    images: frames[0]?.images,
    path: "/sky",
    origin,
    siteName: chrome.siteName,
  });
}

export default async function SkyPage() {
  await useRequestTimeRendering();
  const [atlas, settings] = await Promise.all([buildAtlas(), getSiteSettings()]);
  const chrome = settings ?? DEFAULT_SITE_SETTINGS;

  const subhead = [
    `${atlas.frameCount} ${atlas.frameCount === 1 ? "frame" : "frames"}`,
    `${atlas.panels.length} ${atlas.panels.length === 1 ? "region" : "regions"}`,
    "plotted from plate solves",
  ].join(" · ");

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{chrome.skyHeading}</h1>
      <p className={styles.subhead}>{subhead}</p>

      {atlas.panels.length === 0 ? (
        <div className={styles.empty}>
          Nothing to plot yet. A frame appears here once it has been plate-solved, or once its
          coordinates are filled in on <Link href="/admin">the frame editor</Link>.
        </div>
      ) : (
        <AtlasChart panels={atlas.panels} />
      )}

      {atlas.unplaced.length > 0 ? (
        <section className={styles.unplaced}>
          <h2 className={styles.unplacedHeading}>Not yet plotted</h2>
          <p className={styles.unplacedNote}>
            No plate solve and no readable coordinates — these frames have nowhere to sit on the
            chart.
          </p>
          <ul className={styles.unplacedList}>
            {atlas.unplaced.map((frame) => (
              <li key={frame.slug}>
                <Link href={`/frame/${frame.slug}`} className={styles.unplacedLink}>
                  <span>{frame.catalogId}</span>
                  <span className={styles.unplacedMeta}>
                    {frame.dateLabel} · {frame.integrationLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
