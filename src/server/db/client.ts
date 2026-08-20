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
  return { db: drizzle(sqlite, { schema }), sqlite };
}

type DatabaseState = ReturnType<typeof open>;
type DatabaseClient = DatabaseState["db"];

// Next's dev server re-evaluates modules on every edit; without memoising we
// would leak a file handle per reload. Opening lazily is equally important in
// production: `next build` imports server modules and must not create a database
// inside Hostinger's replaceable build directory.
const globalForDb = globalThis as unknown as {
  __astroblogDb?: DatabaseState;
};

export function getDb(): DatabaseClient {
  if (!globalForDb.__astroblogDb) globalForDb.__astroblogDb = open();
  return globalForDb.__astroblogDb.db;
}

export function getSqlite(): DatabaseState["sqlite"] {
  if (!globalForDb.__astroblogDb) globalForDb.__astroblogDb = open();
  return globalForDb.__astroblogDb.sqlite;
}

/**
 * Backwards-compatible lazy facade. Existing query modules can keep importing
 * `db`; no SQLite handle is opened until they actually call a Drizzle method.
 */
export const db = new Proxy({} as DatabaseClient, {
  get(_target, property) {
    const client = getDb();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { schema };
export const dbFileExists = () => fs.existsSync(path.resolve(DB_PATH));
