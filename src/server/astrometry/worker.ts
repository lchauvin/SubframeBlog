import "server-only";

import { inArray } from "drizzle-orm";

import { getDb } from "../db/client";
import { plateSolves } from "../db/schema";
import { advanceSolve } from "./solve";

const POLL_MS = 15_000;

const globalForWorker = globalThis as unknown as {
  __astroblogSolveTimer?: NodeJS.Timeout;
  __astroblogSolveTick?: Promise<void>;
};

export async function advanceIncompleteSolves(): Promise<void> {
  if (globalForWorker.__astroblogSolveTick) return globalForWorker.__astroblogSolveTick;

  globalForWorker.__astroblogSolveTick = (async () => {
    const pending = await getDb()
      .select({ frameId: plateSolves.frameId })
      .from(plateSolves)
      .where(inArray(plateSolves.status, ["queued", "solving"]));
    // One at a time keeps a personal site's memory and outbound traffic small.
    for (const row of pending) await advanceSolve(row.frameId);
  })().finally(() => {
    globalForWorker.__astroblogSolveTick = undefined;
  });

  return globalForWorker.__astroblogSolveTick;
}

export function startSolveWorker(): void {
  if (globalForWorker.__astroblogSolveTimer) return;
  void advanceIncompleteSolves();
  globalForWorker.__astroblogSolveTimer = setInterval(
    () => void advanceIncompleteSolves(),
    POLL_MS,
  );
  globalForWorker.__astroblogSolveTimer.unref();
}
