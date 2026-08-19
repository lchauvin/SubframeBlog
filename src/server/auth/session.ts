import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "../db/client";
import { adminUsers, authSessions } from "../db/schema";

export const SESSION_COOKIE = "astroblog_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RENEW_WHEN_UNDER_MS = 15 * 24 * 60 * 60 * 1000; // slide once half-spent

/** The cookie carries the raw token; only its digest is stored, so a database
 *  leak does not hand out usable sessions. */
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(authSessions).values({ id: digest(token), userId, expiresAt });

  // Opportunistic cleanup; there is only ever one user, so this stays cheap.
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export type CurrentAdmin = { id: number; username: string };

export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const id = digest(token);
  const row = await db
    .select({
      userId: adminUsers.id,
      username: adminUsers.username,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, new Date())))
    .get();

  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < RENEW_WHEN_UNDER_MS) {
    await db
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(authSessions.id, id));
  }

  return { id: row.userId, username: row.username };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(authSessions).where(eq(authSessions.id, digest(token)));
  jar.delete(SESSION_COOKIE);
}

/**
 * The real gate. Middleware only checks that a cookie is present — it runs on
 * the edge runtime and cannot open SQLite — so every admin page, action and
 * route handler must call this.
 */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
