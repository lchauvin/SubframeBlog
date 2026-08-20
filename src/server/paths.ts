import path from "node:path";
import fs from "node:fs/promises";

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
export const BACKUP_ROOT = path.join(DATA_ROOT, "backups");

export function isDataRootInsideDeployTree(): boolean {
  const relative = path.relative(path.resolve(process.cwd()), path.resolve(DATA_ROOT));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function ensureDataLayout(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.ASTROBLOG_DATA_DIR) {
      throw new Error(
        "ASTROBLOG_DATA_DIR is required in production. Point it outside Hostinger's nodejs deployment directory.",
      );
    }
    if (isDataRootInsideDeployTree()) {
      throw new Error(
        `ASTROBLOG_DATA_DIR must be outside the deployment directory (${process.cwd()}).`,
      );
    }
  }

  await Promise.all([
    fs.mkdir(DATA_ROOT, { recursive: true }),
    fs.mkdir(MEDIA_ROOT, { recursive: true }),
    fs.mkdir(BACKUP_ROOT, { recursive: true }),
  ]);

  const probe = path.join(DATA_ROOT, `.write-test-${process.pid}`);
  await fs.writeFile(probe, "ok", { flag: "wx" });
  await fs.unlink(probe);
}
