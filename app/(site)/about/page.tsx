import type { Metadata } from "next";

import { DEFAULT_SITE_SETTINGS, pickGearRows } from "@/lib/defaults";
import { toParagraphs } from "@/lib/format";
import { shareMetadata, siteOrigin } from "@/lib/share-meta";
import {
  getFrameBySlug,
  getGearItems,
  getSiteSettings,
  getSiteStats,
  listPublishedFrames,
  pickImage,
} from "@/server/db/queries";
import { useRequestTimeRendering } from "@/server/rendering";

import styles from "./about.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const [settingsRow, origin] = await Promise.all([getSiteSettings(), siteOrigin()]);
  const settings = settingsRow ?? DEFAULT_SITE_SETTINGS;
  const heroFrame = settings.aboutHeroSlug
    ? await getFrameBySlug(settings.aboutHeroSlug)
    : (await listPublishedFrames())[0] ?? null;
  const description =
    toParagraphs(settings.aboutBody)[0] ?? "Narrowband astrophotography from a Bortle 9 sky.";
  return shareMetadata({
    title: "About & rig",
    description,
    images: heroFrame?.images,
    path: "/about",
    origin,
    siteName: settings.siteName,
  });
}

export default async function AboutPage() {
  await useRequestTimeRendering();
  const [settingsRow, stats, gear] = await Promise.all([
    getSiteSettings(),
    getSiteStats(),
    getGearItems(),
  ]);
  const settings = settingsRow ?? DEFAULT_SITE_SETTINGS;
  const rig = pickGearRows(gear);

  // The hero is a chosen frame rather than the prototype's hardcoded file, so
  // its caption cannot drift away from the frame it shows.
  const heroFrame = settings.aboutHeroSlug
    ? await getFrameBySlug(settings.aboutHeroSlug)
    : (await listPublishedFrames())[0] ?? null;

  const heroImage = heroFrame ? pickImage(heroFrame.images, "article") : null;
  const heroSrc = heroImage?.jpeg?.src ?? heroImage?.webp?.src ?? null;

  return (
    <main className={styles.page}>
      <div className={styles.left}>
        <div className={styles.kicker}>{settings.aboutKicker}</div>
        <h1 className={styles.heading}>{settings.aboutHeading}</h1>

        {toParagraphs(settings.aboutBody).map((p, i) => (
          <p className={styles.paragraph} key={i}>
            {p}
          </p>
        ))}

        {stats.length > 0 ? (
          <div className={styles.stats}>
            {stats.map((s) => (
              <div className={styles.statCell} key={s.id}>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        ) : null}

        {rig.length > 0 ? (
          <>
            <div className={styles.rigLabel}>{settings.aboutRigLabel}</div>
            <div className={styles.rigList}>
              {rig.map((g, i) => (
                <div className={styles.rigRow} key={`${g.keyLabel}-${i}`}>
                  <div className={styles.rigKey}>{g.keyLabel}</div>
                  <div className={styles.rigValue}>{g.value}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <aside className={styles.right}>
        <div className={styles.hero}>
          {heroSrc ? (
            <img
              className={styles.heroImage}
              src={heroSrc}
              alt={heroFrame ? heroFrame.catalogId : ""}
            />
          ) : null}
          {settings.aboutHeroCaption ? (
            <span className={styles.heroCaption}>{settings.aboutHeroCaption}</span>
          ) : null}
        </div>

        <div className={styles.card}>
          <div className={styles.cardLabel}>{settings.printsLabel}</div>
          <p className={styles.cardBody}>{settings.printsBody}</p>
          <a className={styles.cardButton} href={settings.contactHref || "#"}>
            {settings.printsButtonLabel}
          </a>
        </div>
      </aside>
    </main>
  );
}
