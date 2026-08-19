import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/server/auth/session";

import { AdminNav } from "./AdminNav";
import { logout } from "../login/actions";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The real gate. Middleware only checked that a cookie exists.
  const admin = await requireAdmin();

  return (
    <div className={styles.shell}>
      <div className={styles.bar}>
        <div className={styles.barLeft}>
          <span className={styles.barBrand}>
            <span className={styles.barMark} />
            Subframe
          </span>
          <AdminNav />
        </div>

        <div className={styles.barLeft}>
          <Link href="/" className={styles.barLink} target="_blank">
            View site ↗
          </Link>
          <span className={styles.barUser}>{admin.username}</span>
          <form action={logout}>
            <button type="submit" className={styles.button}>
              Sign out
            </button>
          </form>
        </div>
      </div>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
