import "server-only";

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// In-memory is the right scope here: one user, one process. A restart clearing
// the counters is acceptable for a personal site.
const globalForLimit = globalThis as unknown as { __astroblogLoginBuckets?: Map<string, Bucket> };
const buckets = (globalForLimit.__astroblogLoginBuckets ??= new Map<string, Bucket>());

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkLoginAttempt(key: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Called after a successful login so a good password clears the counter. */
export function clearLoginAttempts(key: string): void {
  buckets.delete(key);
}
