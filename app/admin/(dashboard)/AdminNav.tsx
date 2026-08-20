"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../admin.module.css";

const LINKS = [
  { href: "/admin", label: "Frames" },
  { href: "/admin/site", label: "Site & rig" },
  { href: "/admin/diagnostics", label: "Diagnostics" },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <>
      {LINKS.map((l) => {
        const active =
          l.href === "/admin"
            ? pathname === "/admin" || pathname.startsWith("/admin/frames")
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`${styles.barLink} ${active ? styles.barLinkActive : ""}`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
