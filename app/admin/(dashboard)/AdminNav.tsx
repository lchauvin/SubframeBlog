"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../admin.module.css";

const LINKS = [
  { href: "/admin", label: "Frames" },
  { href: "/admin/site", label: "Site & rig" },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <>
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? !pathname.startsWith("/admin/site") : pathname.startsWith(l.href);
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
