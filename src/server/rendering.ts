import "server-only";

/**
 * Public pages are static only during the explicit export workflow. In the
 * normal Node deployment they must read SQLite at request time so publishing
 * from the admin becomes visible immediately.
 */
export async function useRequestTimeRendering(): Promise<void> {
  if (process.env.ASTROBLOG_EXPORT === "1") return;

  const { connection } = await import("next/server");
  await connection();
}
