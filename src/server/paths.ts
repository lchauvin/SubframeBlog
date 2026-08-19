import path from "node:path";

/**
 * Runtime data lives outside `public/` on purpose: files written after the
 * build are not reliably served from `public/`, so media goes through
 * `app/media/[...path]/route.ts` instead.
 */
export const DATA_ROOT = process.env.ASTROBLOG_DATA_DIR
  ? path.resolve(process.env.ASTROBLOG_DATA_DIR)
  : path.join(process.cwd(), "data");

export const DB_PATH = path.join(DATA_ROOT, "astroblog.db");
export const MEDIA_ROOT = path.join(DATA_ROOT, "media");
