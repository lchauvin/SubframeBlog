import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

import { DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import { siteOrigin } from "@/lib/share-meta";
import { getSiteSettings } from "@/server/db/queries";
import "@/styles/global.css";

// Self-hosted at build time, satisfying the README's "self-host for production"
// without a manual font drop. Exposed as the variables tokens.css defers to.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

/**
 * The root layout wraps every route, including `/_not-found`, which the build
 * prerenders. A throw here therefore fails the whole build rather than one
 * page, so a settings read — cosmetic, and with a defined fallback — must not
 * be able to do that. Migrations run before the build (see
 * scripts/build-server.mjs); this only covers the schema still being behind.
 */
async function siteSettingsOrDefaults() {
  try {
    return (await getSiteSettings()) ?? DEFAULT_SITE_SETTINGS;
  } catch (error) {
    console.error(
      "[astroblog] Could not read site settings for metadata; using defaults. " +
        "If this appears during a build, the database is behind the code — run `npm run db:migrate`.",
      error,
    );
    return DEFAULT_SITE_SETTINGS;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = await siteOrigin();
  const settings = await siteSettingsOrDefaults();
  return {
    metadataBase: origin,
    title: settings.siteName,
    description: "Narrowband astrophotography from a Bortle 9 sky.",
    openGraph: {
      siteName: settings.siteName,
      locale: "en_CA",
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
