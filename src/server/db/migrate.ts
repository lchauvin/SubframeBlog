import "server-only";

import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb } from "./client";

const globalForMigrations = globalThis as unknown as {
  __astroblogMigration?: Promise<void>;
};

function migrationsFolder(): string {
  const candidates = [
    path.join(process.cwd(), "drizzle"),
    process.argv[1] ? path.join(path.dirname(process.argv[1]), "drizzle") : "",
  ].filter(Boolean);

  const folder = candidates.find((candidate) => fs.existsSync(candidate));
  if (!folder) {
    throw new Error(
      `Drizzle migrations were not bundled. Checked: ${candidates.join(", ")}`,
    );
  }
  return folder;
}

export function runMigrations(): Promise<void> {
  globalForMigrations.__astroblogMigration ??= Promise.resolve().then(() => {
    migrate(getDb(), { migrationsFolder: migrationsFolder() });
  });
  return globalForMigrations.__astroblogMigration;
}
