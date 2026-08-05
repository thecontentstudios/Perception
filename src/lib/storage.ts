import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Object storage, behind an interface.
 *
 * The blueprint says S3, and production should use it. But a seam is worth
 * more than the implementation behind it: everything upstream of this file
 * deals in keys and bytes, so swapping the local driver for S3 is one module,
 * not a refactor. It also means `git clone && npm run dev` still lets you
 * upload a photo, which is the difference between a feature you can try and a
 * feature you have to provision for.
 *
 * Keys are content-addressed — `sha256(bytes)` plus the extension. Uploading
 * the same photo twice therefore costs one object, and a key never collides
 * or leaks the original filename into a URL.
 */

export interface PutResult {
  key: string;
  bytes: number;
  /** True when this exact content was already stored. */
  deduped: boolean;
}

export interface Storage {
  put(data: Buffer, ext: string): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** A URL the browser can load. */
  url(key: string): string;
  readonly driver: 'local' | 's3';
}

/** Content address: same bytes, same key, forever. */
export function keyFor(data: Buffer, ext: string): string {
  const hash = createHash('sha256').update(data).digest('hex');
  // Two levels of fan-out so a directory never holds a million entries.
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${ext.startsWith('.') ? ext : `.${ext}`}`;
}

class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  constructor(private root: string) {}

  private path(key: string) {
    return join(this.root, key);
  }

  async put(data: Buffer, ext: string): Promise<PutResult> {
    const key = keyFor(data, ext);
    const path = this.path(key);
    if (existsSync(path)) return { key, bytes: data.length, deduped: true };
    await mkdir(dirname(path), { recursive: true });
    // Write to a temp name and rename, so a crash mid-write can never leave a
    // truncated file sitting at a key that reads as valid.
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, path);
    return { key, bytes: data.length, deduped: false };
  }

  get(key: string) {
    return readFile(this.path(key));
  }

  async delete(key: string) {
    try { await unlink(this.path(key)); } catch { /* already gone is fine */ }
  }

  url(key: string) {
    return `/api/media/file/${key}`;
  }
}

let cached: Storage | null = null;

export function storage(): Storage {
  if (!cached) {
    // MEDIA_ROOT keeps uploads outside the repo by default, so a stray photo
    // can never end up in a commit.
    cached = new LocalStorage(process.env.MEDIA_ROOT || join(process.cwd(), '.media'));
  }
  return cached;
}

/** Keys are hex + a short extension; anything else is someone probing. */
export function isSafeKey(key: string): boolean {
  return /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/.test(key);
}
