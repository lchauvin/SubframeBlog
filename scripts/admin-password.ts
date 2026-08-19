/**
 * Creates or updates the single admin account. There is no signup page by
 * design — this is how credentials get into the database.
 *
 *   npm run admin:password
 *   npm run admin:password -- --username laurent
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq } from "drizzle-orm";

import { db } from "../src/server/db/client";
import { adminUsers, authSessions } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";

/** Reads a line without echoing it, so the password never appears on screen. */
async function readSecret(prompt: string): Promise<string> {
  stdout.write(prompt);
  const wasRaw = stdin.isRaw ?? false;
  if (stdin.isTTY) stdin.setRawMode(true);

  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  // Non-interactive path for scripted setup. An env var rather than a flag, so
  // the password never lands in shell history.
  const fromEnv = process.env.ASTROBLOG_ADMIN_PASSWORD;

  let username = argValue("--username");
  if (!username && !fromEnv) username = (await rl.question("Username: ")).trim();
  rl.close();

  if (!username) throw new Error("Username is required (--username or the prompt).");

  let password: string;
  if (fromEnv) {
    password = fromEnv;
  } else {
    password = await readSecret("Password (not echoed): ");
    const again = await readSecret("Confirm password: ");
    if (password !== again) throw new Error("Passwords did not match.");
  }

  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }

  const passwordHash = await hashPassword(password);
  const existing = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .get();

  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash })
      .where(eq(adminUsers.id, existing.id));
    // A password change should not leave old sessions logged in.
    await db.delete(authSessions).where(eq(authSessions.userId, existing.id));
    console.log(`Updated password for "${username}" and signed out existing sessions.`);
  } else {
    await db.insert(adminUsers).values({ username, passwordHash, createdAt: new Date() });
    console.log(`Created admin "${username}".`);
  }

  console.log("Sign in at /admin/login");
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
