"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { checkLoginAttempt, clearLoginAttempts } from "@/server/auth/rate-limit";
import { fakeVerify, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { adminUsers } from "@/server/db/schema";

export type LoginState = { error?: string };

async function clientKey(username: string): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return `${username.toLowerCase()}|${ip}`;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "");

  // Only ever redirect back into the admin — never to an attacker-supplied host.
  const next = nextRaw.startsWith("/admin") ? nextRaw : "/admin";

  if (!username || !password) return { error: "Enter a username and password." };

  const limit = checkLoginAttempt(await clientKey(username));
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const user = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .get();

  // fakeVerify keeps the timing of "no such user" close to "wrong password".
  const ok = user ? await verifyPassword(password, user.passwordHash) : await fakeVerify();

  // Same message either way — no user enumeration.
  if (!ok || !user) return { error: "Invalid credentials." };

  clearLoginAttempts(await clientKey(username));
  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, user.id));
  await createSession(user.id);

  redirect(next);
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/admin/login");
}
