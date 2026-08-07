import { NextResponse } from 'next/server';
import { isSafeKey, storage } from '@/lib/storage';

/**
 * Serve a stored object.
 *
 * In production a CDN sits in front of S3 and this route does not exist. It is
 * here so the local driver has somewhere to serve from, which is what makes
 * upload work on a fresh clone with nothing provisioned.
 *
 * The key is validated against its exact shape rather than filtered for `..`.
 * A whitelist of "64 hex characters and a short extension" cannot be talked
 * into reading `/etc/passwd`; a blacklist of bad sequences is a game you keep
 * having to win.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join('/');

  if (!isSafeKey(key)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const data = await storage().get(key);
    const ext = key.split('.').pop() ?? '';
    const type =
      { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' }[ext] ??
      'application/octet-stream';

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'content-type': type,
        // Content-addressed keys never change what they point at, so this can
        // be cached forever.
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
