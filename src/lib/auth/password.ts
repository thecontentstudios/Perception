import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt rather than bcrypt or argon2 for one reason that matters more than
 * the marginal differences between them: it is in Node's standard library.
 * A native-addon dependency in the auth path is a thing that breaks on a
 * platform upgrade, at which point nobody can log in — and "nobody can log in"
 * is a worse outage than almost anything else this product can do.
 *
 * Parameters are stored *in the hash*, so raising the cost later doesn't
 * invalidate everyone's password: old hashes keep verifying with their own
 * parameters and get upgraded on next login.
 */

// N=2^16 ≈ 100ms on current hardware. Deliberately slow: the whole point is
// that an attacker with the hash file has to spend that per guess.
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 64;
// scrypt's default maxmem (32 MB) is below what N=65536 needs (~128 MB), and
// the failure is a confusing "memory limit exceeded" rather than anything
// about passwords.
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // A user with no password set must not be loggable-into, and must take the
  // same time to reject as a wrong password — otherwise the response time says
  // which accounts exist.
  if (!stored) {
    await hashPassword(password);
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), Buffer.from(hashB64, 'base64').length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  const expected = Buffer.from(hashB64, 'base64');
  if (derived.length !== expected.length) return false;
  // Constant time: a byte-by-byte compare leaks how much of the hash matched.
  return timingSafeEqual(derived, expected);
}

/** True when a stored hash used weaker parameters than we now require. */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N;
}

/**
 * The bar for a new password.
 *
 * Length, and a check against the passwords everyone actually picks. No
 * composition rules — "must contain a symbol" reliably produces `Password1!`
 * and teaches people to write passwords down, while a 12-character passphrase
 * beats it comfortably.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwertyuiop',
  'letmein123', 'welcome123', 'admin12345', 'iloveyou123', 'perception',
]);

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters — a short phrase you can remember works well.';
  if (password.length > 200) return 'That password is too long.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password appears on every breach list. Pick something else.';
  if (email && lower.includes(email.split('@')[0].toLowerCase())) {
    return 'Your password should not contain your email address.';
  }
  if (new Set(password).size < 5) return 'That password repeats too few distinct characters.';
  return null;
}
