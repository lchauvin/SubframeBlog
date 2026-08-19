import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// scrypt from node:crypto rather than bcrypt/argon2: no native module to
// compile, which matters on Windows.
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

/** Encoded as `scrypt$N$r$p$saltHex$keyHex`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("hex"),
    key.toString("hex"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Burns a comparable amount of time when no such user exists, so a failed
 * lookup is not distinguishable from a wrong password by response time.
 */
export async function fakeVerify(): Promise<false> {
  await scryptAsync("astroblog-timing-equaliser", randomBytes(16), KEYLEN, PARAMS);
  return false;
}
