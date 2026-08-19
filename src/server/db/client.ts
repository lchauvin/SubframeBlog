import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

// Relative rather than aliased: this module is also loaded by the CLI scripts,
// which run under plain Node and cannot resolve the `@/` alias.
import { DATA_ROOT, DB_PATH } from "../paths";
import * as schema from "./schema";

function open() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

// Next's dev server re-evaluates modules on every edit; without memoising we
// would leak a file handle per reload.
const globalForDb = globalThis as unknown as {
  __astroblogDb?: ReturnType<typeof open>;
};

export const db = globalForDb.__astroblogDb ?? open();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__astroblogDb = db;
}

export { schema };
export const dbFileExists = () => fs.existsSync(path.resolve(DB_PATH));
