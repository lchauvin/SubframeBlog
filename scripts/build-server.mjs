import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

/**
 * Migrate before building, not just at startup.
 *
 * `next build` prerenders pages, and the root layout's generateMetadata reads
 * site settings — so the build opens SQLite while the deployed code is newer
 * than the schema on disk. On a host that builds before it starts the app
 * (Hostinger does), a migration that adds a column therefore fails the build
 * with an opaque "/_not-found" prerender error. Applying migrations here closes
 * that window; the call is idempotent and the startup one still runs.
 */
const migration = spawnSync(process.execPath, [path.join(root, "scripts", "migrate.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (migration.status !== 0) {
  console.error("Migrations failed; refusing to build against a stale schema.");
  process.exit(migration.status ?? 1);
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const standalone = path.join(root, ".next", "standalone");
try {
  await fs.access(standalone);
} catch {
  // Static exports do not create a standalone server.
  process.exit(0);
}

// File tracing can discover local runtime files through dynamic fs calls.
// Never let authoring data or environment files enter the deployable bundle.
await Promise.all([
  fs.rm(path.join(standalone, "data"), { recursive: true, force: true }),
  ...[".env", ".env.local", ".env.production", ".env.production.local"].map((name) =>
    fs.rm(path.join(standalone, name), { force: true }),
  ),
]);

await Promise.all([
  fs.cp(path.join(root, "catalog"), path.join(standalone, "catalog"), {
    recursive: true,
    force: true,
  }),
  fs.cp(path.join(root, "drizzle"), path.join(standalone, "drizzle"), {
    recursive: true,
    force: true,
  }),
  fs.cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
    recursive: true,
    force: true,
  }),
]);

console.log("Standalone runtime assets copied.");
