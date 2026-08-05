import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { storage } from '../storage';

const run = promisify(execFile);

/**
 * Video, via ffmpeg.
 *
 * Everything here shells out rather than linking a library, because ffmpeg is
 * the only implementation anybody trusts and its CLI is the stable interface.
 * The cost is that ffmpeg has to be installed, so every function reports
 * plainly when it is missing rather than failing in a way that looks like a
 * bug in the product.
 */

export interface VideoInfo {
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
}

let available: boolean | null = null;

export async function ffmpegAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await run('ffprobe', ['-version']);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** Run a function with the stored object materialised as a local file. */
async function withLocalCopy<T>(key: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'perception-'));
  const path = join(dir, `in.${key.split('.').pop() ?? 'mp4'}`);
  try {
    await writeFile(path, await storage().get(key));
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probe(key: string): Promise<VideoInfo> {
  if (!(await ffmpegAvailable())) throw new Error('ffmpeg is not installed');
  return withLocalCopy(key, async (path) => {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path,
    ]);
    const data = JSON.parse(stdout);
    const video = data.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    if (!video) throw new Error('no video stream');
    return {
      width: video.width,
      height: video.height,
      durationSec: Math.round(Number(data.format.duration ?? video.duration ?? 0)),
      hasAudio: data.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'),
    };
  });
}

export interface TrimResult {
  key: string;
  durationSec: number;
  bytes: number;
}

/**
 * Trim a video to a maximum length.
 *
 * Takes from the *start*, deliberately. A platform limit is not an invitation
 * to guess which fifteen seconds mattered — the opening is where the owner put
 * the hook, and cutting from anywhere else silently rewrites their video. The
 * UI says exactly what will be dropped before this runs.
 *
 * Re-encodes rather than stream-copying: a copy cuts at the nearest keyframe,
 * which can be seconds off and can leave a black opening frame. Slower, right.
 */
export async function trim(key: string, maxSeconds: number): Promise<TrimResult> {
  if (!(await ffmpegAvailable())) throw new Error('ffmpeg is not installed');
  return withLocalCopy(key, async (path) => {
    const out = `${path}.trimmed.mp4`;
    await run('ffmpeg', [
      '-y', '-i', path,
      '-t', String(maxSeconds),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      // Strip container metadata on the way through — the same privacy reason
      // images get their EXIF removed.
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      out,
    ]);
    const data = await readFile(out);
    const put = await storage().put(data, 'mp4');
    return { key: put.key, durationSec: maxSeconds, bytes: put.bytes };
  });
}

/**
 * Re-frame a video to a target aspect ratio by cropping the centre.
 *
 * Centre-crop is a guess, and a bad one for a video where the subject sits to
 * one side. It is offered because the alternative — a 9:16 slot showing a
 * letterboxed 16:9 clip — looks broken on every phone. The owner can always
 * upload a version framed the way they want.
 */
export async function reframe(key: string, ratio: '1:1' | '4:5' | '9:16' | '16:9'): Promise<TrimResult> {
  if (!(await ffmpegAvailable())) throw new Error('ffmpeg is not installed');
  const [rw, rh] = ratio.split(':').map(Number);
  return withLocalCopy(key, async (path) => {
    const out = `${path}.${rw}x${rh}.mp4`;
    // Crop to the largest centred rectangle of the target ratio that fits, then
    // round to even dimensions — H.264 requires it and odd values fail late.
    const crop = `crop='min(iw,ih*${rw}/${rh})/2*2':'min(ih,iw*${rh}/${rw})/2*2'`;
    await run('ffmpeg', [
      '-y', '-i', path,
      '-vf', crop,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'copy', '-map_metadata', '-1', '-movflags', '+faststart',
      out,
    ]);
    const data = await readFile(out);
    const put = await storage().put(data, 'mp4');
    const info = await probe(put.key);
    return { key: put.key, durationSec: info.durationSec, bytes: put.bytes };
  });
}
