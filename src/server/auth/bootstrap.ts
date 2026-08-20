import "server-only";

import { hashPassword } from "./password";
import { getDb } from "../db/client";
import { adminUsers } from "../db/schema";

export type BootstrapResult = "existing" | "created" | "missing-credentials";

export async function bootstrapFirstAdmin(): Promise<BootstrapResult> {
  const db = getDb();
  const existing = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  if (existing.length > 0) return "existing";

  const username = (process.env.ASTROBLOG_ADMIN_USERNAME || "admin").trim();
  const password = process.env.ASTROBLOG_ADMIN_PASSWORD;
  if (!password) {
    console.warn(
      "[astroblog] No admin exists. Set ASTROBLOG_ADMIN_PASSWORD (and optionally ASTROBLOG_ADMIN_USERNAME), then restart.",
    );
    return "missing-credentials";
  }
  if (!username) throw new Error("ASTROBLOG_ADMIN_USERNAME cannot be blank.");
  if (password.length < 12) {
    throw new Error("ASTROBLOG_ADMIN_PASSWORD must be at least 12 characters.");
  }

  await db.insert(adminUsers).values({
    username,
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
  });
  console.warn(
    `[astroblog] Created admin "${username}". Remove ASTROBLOG_ADMIN_PASSWORD from Hostinger and redeploy.`,
  );
  return "created";
}
