import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getSiteSettings } from "@/server/db/queries";
import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { useRequestTimeRendering } from "@/server/rendering";

/**
 * Public chrome. The fullscreen viewer deliberately sits outside this layout —
 * it is its own full-bleed surface with no header or footer.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await useRequestTimeRendering();
  const settings = (await getSiteSettings()) ?? DEFAULT_SITE_SETTINGS;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        siteName={settings.siteName}
        tagline={settings.siteTagline}
        logLabel={settings.navLogLabel}
        skyLabel={settings.navSkyLabel}
        aboutLabel={settings.navAboutLabel}
      />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer left={settings.footerLeft} right={settings.footerRight} />
    </div>
  );
}
