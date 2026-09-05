import "server-only";

import { bootstrapFirstAdmin } from "./auth/bootstrap";
import { ensureCardFonts } from "./cards/fonts";
import { startSolveWorker } from "./astrometry/worker";
import { runMigrations } from "./db/migrate";
import { ensureDataLayout } from "./paths";

const globalForStartup = globalThis as unknown as {
  __astroblogStartup?: Promise<void>;
};

async function initialize(): Promise<void> {
  await ensureDataLayout();
  await runMigrations();
  await bootstrapFirstAdmin();
  // fontconfig latches its configuration the first time a glyph is drawn, so
  // this has to happen before anything in the process renders text.
  await ensureCardFonts();
  startSolveWorker();
  console.info("[astroblog] Runtime storage and database are ready.");
}

export function runStartup(): Promise<void> {
  globalForStartup.__astroblogStartup ??= initialize();
  return globalForStartup.__astroblogStartup;
}
