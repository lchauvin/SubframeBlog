export async function register(): Promise<void> {
  // Development opens SQLite lazily through the route that needs it. Keeping
  // the production bootstrap out of the dev bundle prevents Next from tracing
  // better-sqlite3 (and its native `fs` dependency) into an edge compilation.
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { runStartup } = await import("./src/server/startup");
  await runStartup();
}
