import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "astroblog-deploy-"));
process.env.NODE_ENV = "production";
process.env.ASTROBLOG_DATA_DIR = temp;
process.env.ASTROBLOG_ADMIN_USERNAME = "deployment-check";
process.env.ASTROBLOG_ADMIN_PASSWORD = "deployment-check-password";

try {
  const [
    { bootstrapFirstAdmin },
    { getSqlite },
    { runMigrations },
    { checkReadiness },
    { shouldKeepWaitingForJob },
    paths,
  ] = await Promise.all([
      import("../src/server/auth/bootstrap"),
      import("../src/server/db/client"),
      import("../src/server/db/migrate"),
      import("../src/server/health"),
      import("../src/server/astrometry/solve"),
      import("../src/server/paths"),
    ]);

  await paths.ensureDataLayout();
  await runMigrations();
  assert.equal(await bootstrapFirstAdmin(), "created");
  assert.equal(await bootstrapFirstAdmin(), "existing");

  const readiness = await checkReadiness();
  assert.equal(readiness.ok, true, JSON.stringify(readiness));
  assert.equal(paths.isDataRootInsideDeployTree(), false);
  await fs.access(paths.DB_PATH);

  const now = Date.now();
  assert.equal(shouldKeepWaitingForJob(true, new Date(now - 60_000), now), true);
  assert.equal(shouldKeepWaitingForJob(true, new Date(now - 16 * 60_000), now), false);
  assert.equal(shouldKeepWaitingForJob(false, new Date(now - 60 * 60_000), now), true);

  const snapshot = path.join(paths.BACKUP_ROOT, "verify.db");
  await getSqlite().backup(snapshot);
  assert.ok((await fs.stat(snapshot)).size > 0);
  getSqlite().close();

  console.log("DEPLOYMENT RUNTIME CHECKS PASSED");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
