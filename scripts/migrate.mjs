/**
 * Applies the generated Drizzle migrations to data/astroblog.db.
 * Run with: npm run db:migrate
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const root = process.cwd();
const dataDir = process.env.ASTROBLOG_DATA_DIR
  ? path.resolve(process.env.ASTROBLOG_DATA_DIR)
  : path.join(root, "data");

fs.mkdirSync(path.join(dataDir, "media"), { recursive: true });

const dbPath = path.join(dataDir, "astroblog.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder: path.join(root, "drizzle") });
sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
