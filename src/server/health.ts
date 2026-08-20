import "server-only";

import fs from "node:fs/promises";
import { constants } from "node:fs";

import { catalogAvailable } from "./astrometry/catalog";
import { getSqlite } from "./db/client";
import { DATA_ROOT, MEDIA_ROOT } from "./paths";

export type Readiness = {
  ok: boolean;
  checks: {
    database: boolean;
    migrations: boolean;
    dataWritable: boolean;
    mediaAccessible: boolean;
    catalog: boolean;
  };
};

export async function checkReadiness(): Promise<Readiness> {
  let database = false;
  let migrations = false;
  let dataWritable = false;
  let mediaAccessible = false;

  try {
    const sqlite = getSqlite();
    sqlite.prepare("select 1").get();
    database = true;
    const row = sqlite
      .prepare(
        "select count(*) as count from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get() as { count?: number } | undefined;
    migrations = Number(row?.count) === 1;
  } catch {
    // The structured response intentionally omits filesystem and SQL details.
  }

  try {
    await fs.access(DATA_ROOT, constants.R_OK | constants.W_OK);
    dataWritable = true;
  } catch {}

  try {
    await fs.access(MEDIA_ROOT, constants.R_OK | constants.W_OK);
    mediaAccessible = true;
  } catch {}

  const checks = {
    database,
    migrations,
    dataWritable,
    mediaAccessible,
    catalog: catalogAvailable(),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}
