/**
 * Builds the public site as plain static files for shared hosting.
 *
 *   npm run export
 *
 * Produces out/ — upload its contents to Hostinger's public_html. No Node runs
 * on the server: the admin, the media route handler and every server action are
 * excluded from this build (see next.config.ts), and data/media is copied in as
 * real files so the /media/... URLs the pages already use keep resolving.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { listPublishedSlugs } from "../src/server/db/queries";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const MEDIA_SRC = path.join(
  process.env.ASTROBLOG_DATA_DIR ? path.resolve(process.env.ASTROBLOG_DATA_DIR) : path.join(ROOT, "data"),
  "media",
);
const MEDIA_OUT = path.join(OUT, "media");

/** Derivatives the pages never reference — no reason to upload them. */
const SKIP_VARIANTS = [/(^|[\\/])master\.[^\\/]+$/];

async function copyMedia(): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;

  async function walk(src: string, dest: string) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    await fs.mkdir(dest, { recursive: true });

    for (const entry of entries) {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await walk(from, to);
      } else if (!SKIP_VARIANTS.some((re) => re.test(from))) {
        await fs.copyFile(from, to);
        files += 1;
        bytes += (await fs.stat(to)).size;
      }
    }
  }

  try {
    await walk(MEDIA_SRC, MEDIA_OUT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`  ! ${MEDIA_SRC} not found — no media copied.`);
      return { files: 0, bytes: 0 };
    }
    throw err;
  }
  return { files, bytes };
}

async function countHtml(dir: string): Promise<number> {
  let n = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) n += await countHtml(p);
    else if (entry.name.endsWith(".html")) n += 1;
  }
  return n;
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/**
 * Fails the export when it emitted no page for a published frame.
 *
 * Route config that opts a page out of prerendering does not fail this build —
 * Next simply writes nothing and reports success. That silently shipped a site
 * with every article missing once already, so the count is checked rather than
 * trusted.
 */
async function verifyPages(): Promise<number> {
  const slugs = await listPublishedSlugs();
  const missing: string[] = [];

  for (const slug of slugs) {
    if (!(await exists(path.join(OUT, "frame", slug, "index.html")))) {
      missing.push(`/frame/${slug}`);
    }
    if (!(await exists(path.join(OUT, "frame", slug, "full", "index.html")))) {
      missing.push(`/frame/${slug}/full`);
    }
  }
  for (const route of ["index.html", path.join("about", "index.html"), path.join("sky", "index.html")]) {
    if (!(await exists(path.join(OUT, route)))) missing.push(`/${route.replace(/index\.html$/, "")}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Export is missing ${missing.length} page(s) despite building cleanly:\n  ${missing.join("\n  ")}`,
    );
  }
  return slugs.length;
}

async function main() {
  console.log("Building static export…\n");

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.rm(path.join(ROOT, ".next"), { recursive: true, force: true });

  // The export reads SQLite at build time and never starts the server, so the
  // startup migration never runs. Without this a schema change fails the build
  // on an opaque "/_not-found" prerender error. See scripts/build-server.mjs.
  console.log("Applying migrations…");
  const migration = spawnSync(process.execPath, [path.join(ROOT, "scripts", "migrate.mjs")], {
    stdio: "inherit",
    env: process.env,
  });
  if (migration.status !== 0) {
    console.error("\nMigrations failed; refusing to export against a stale schema.");
    process.exit(migration.status ?? 1);
  }

  const build = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, ASTROBLOG_EXPORT: "1" },
    shell: process.platform === "win32",
  });

  if (build.status !== 0) {
    console.error("\nnext build failed.");
    process.exit(build.status ?? 1);
  }

  console.log("\nCopying media…");
  const media = await copyMedia();

  // Plain Apache/LiteSpeed needs telling where the 404 lives.
  await fs.writeFile(
    path.join(OUT, ".htaccess"),
    [
      "ErrorDocument 404 /404.html",
      "",
      "# Long cache for immutable build assets.",
      "<IfModule mod_expires.c>",
      "  ExpiresActive On",
      "  ExpiresByType image/jpeg  \"access plus 1 month\"",
      "  ExpiresByType image/webp  \"access plus 1 month\"",
      "  ExpiresByType text/css    \"access plus 1 year\"",
      "  ExpiresByType application/javascript \"access plus 1 year\"",
      "</IfModule>",
      "",
    ].join("\n"),
  );

  const frameCount = await verifyPages();
  const pages = await countHtml(OUT);
  console.log(
    `\n${pages} HTML pages (${frameCount} published frames, article + viewer each) · ` +
      `${media.files} media files (${(media.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(`\nReady: ${OUT}`);
  console.log("Upload the CONTENTS of out/ to Hostinger's public_html.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
