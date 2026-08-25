"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import styles from "./Header.module.css";

export function Header({
  siteName,
  tagline,
  logLabel,
  skyLabel,
  aboutLabel,
}: {
  siteName: string;
  tagline: string;
  logLabel: string;
  skyLabel: string;
  aboutLabel: string;
}) {
  const pathname = usePathname() ?? "/";
  const onAbout = pathname.startsWith("/about");
  const onSky = pathname.startsWith("/sky");
  // "The log" stays active on article and viewer routes, matching the prototype.
  const onLog = !onAbout && !onSky;

  const cls = (active: boolean) =>
    active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <span className={styles.brandName}>{siteName}</span>
          <span className={styles.brandTagline}>{tagline}</span>
        </Link>

        <nav className={styles.nav}>
          <Link href="/" className={cls(onLog)} aria-current={onLog ? "page" : undefined}>
            {logLabel}
          </Link>
          <Link href="/sky" className={cls(onSky)} aria-current={onSky ? "page" : undefined}>
            {skyLabel}
          </Link>
          <Link
            href="/about"
            className={cls(onAbout)}
            aria-current={onAbout ? "page" : undefined}
          >
            {aboutLabel}
          </Link>
          <span className={styles.search} aria-hidden="true">
            <Search size={14} strokeWidth={1.5} />
            <span className={styles.searchLabel}>Search</span>
          </span>
        </nav>
      </div>
    </header>
  );
}
