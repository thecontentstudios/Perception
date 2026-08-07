import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Token encryption. Real AES-256-GCM, not a placeholder.
 *
 * Platform tokens are the crown jewels of this product: a leaked Page token
 * lets someone post as the business. They are encrypted at rest with a key
 * that lives only in the environment, and they are never sent to the browser
 * — not in an API response, not in a prop, not even to the account owner.
 *
 * Key: TOKEN_ENCRYPTION_KEY, 32 bytes base64.
 *   openssl rand -base64 32
 */

const ALGO = 'aes-256-gcm';

export class MissingKeyError extends Error {
  constructor() {
    super(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and put it in .env.local.'
    );
    this.name = 'MissingKeyError';
  }
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new MissingKeyError();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}.`);
  }
  return buf;
}

export function hasEncryptionKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt to a self-describing string: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  // GCM authenticates on final() — tampering throws rather than returning junk.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// PKCE + state
// ---------------------------------------------------------------------------

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** PKCE S256 challenge from a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Constant-time comparison for the OAuth `state` parameter. A fast-exit
 * comparison here leaks timing information that helps an attacker forge a
 * callback, which is the whole thing `state` exists to prevent.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
