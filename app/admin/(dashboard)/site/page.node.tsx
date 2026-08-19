import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { getGearItems, getSiteSettings, getSiteStats, listAllFrames } from "@/server/db/queries";

import { SiteForm, type SiteFormValues } from "./SiteForm";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminSitePage() {
  const [settings, gear, stats, frames] = await Promise.all([
    getSiteSettings(),
    getGearItems(),
    getSiteStats(),
    listAllFrames(),
  ]);

  const source = settings ?? DEFAULT_SITE_SETTINGS;

  const values: SiteFormValues = {
    siteName: source.siteName,
    siteTagline: source.siteTagline,
    navLogLabel: source.navLogLabel,
    navAboutLabel: source.navAboutLabel,
    logHeading: source.logHeading,
    logPaginationLabel: source.logPaginationLabel,
    aboutKicker: source.aboutKicker,
    aboutHeading: source.aboutHeading,
    aboutBody: source.aboutBody,
    aboutRigLabel: source.aboutRigLabel,
    aboutHeroSlug: source.aboutHeroSlug,
    aboutHeroCaption: source.aboutHeroCaption,
    printsLabel: source.printsLabel,
    printsBody: source.printsBody,
    printsButtonLabel: source.printsButtonLabel,
    contactHref: source.contactHref,
    footerLeft: source.footerLeft,
    footerRight: source.footerRight,
  };

  return (
    <>
      <h1 className={styles.pageTitle}>Site &amp; rig</h1>
      <p className={styles.pageSub}>Chrome, about copy, gear list and stats</p>

      <SiteForm
        values={values}
        gear={gear.map((g) => ({ keyLabel: g.keyLabel, value: g.value }))}
        stats={stats.map((s) => ({ value: s.value, label: s.label }))}
        frameOptions={frames.map((f) => ({
          slug: f.slug,
          label: `${f.catalogId}${f.commonName ? ` — ${f.commonName}` : ""}`,
        }))}
      />
    </>
  );
}
