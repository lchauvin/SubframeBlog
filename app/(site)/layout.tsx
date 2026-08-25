import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getSiteSettings, listSearchDocs } from "@/server/db/queries";
import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { useRequestTimeRendering } from "@/server/rendering";

/**
 * Public chrome. The fullscreen viewer deliberately sits outside this layout —
 * it is its own full-bleed surface with no header or footer.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await useRequestTimeRendering();
  const [settings, searchDocs] = await Promise.all([getSiteSettings(), listSearchDocs()]);
  const chrome = settings ?? DEFAULT_SITE_SETTINGS;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        siteName={chrome.siteName}
        tagline={chrome.siteTagline}
        logLabel={chrome.navLogLabel}
        skyLabel={chrome.navSkyLabel}
        aboutLabel={chrome.navAboutLabel}
        searchDocs={searchDocs}
      />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer left={chrome.footerLeft} right={chrome.footerRight} />
    </div>
  );
}
