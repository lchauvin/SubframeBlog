import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

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

export const metadata: Metadata = {
  title: "Subframe",
  description: "Narrowband astrophotography from a Bortle 9 sky.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
