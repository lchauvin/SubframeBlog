import type { Config } from "drizzle-kit";
import path from "node:path";

const dataRoot = process.env.ASTROBLOG_DATA_DIR
  ? path.resolve(process.env.ASTROBLOG_DATA_DIR)
  : path.resolve("./data");

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: path.join(dataRoot, "astroblog.db") },
  strict: true,
} satisfies Config;
