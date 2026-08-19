import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegistrationMarks } from "@/components/RegistrationMarks";
import { getCurrentAdmin } from "@/server/auth/session";

import { LoginForm } from "./LoginForm";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentAdmin()) redirect("/admin");

  const { next } = await searchParams;
  const target = next?.startsWith("/admin") ? next : "/admin";

  return (
    <main className={styles.loginPage}>
      <div className={styles.loginCard}>
        <RegistrationMarks />
        <h1 className={styles.loginTitle}>Subframe</h1>
        <p className={styles.loginSub}>Admin access</p>
        <LoginForm next={target} />
      </div>
    </main>
  );
}
