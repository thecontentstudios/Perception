import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decrypt, encrypt } from './crypto';
import type { Channel } from '../types';

/**
 * Server-side token store.
 *
 * Deliberately small and swappable: this is the seam where production drops
 * in Prisma. What matters is the shape and the rule — tokens are written
 * encrypted and are never returned to a caller that only needs metadata.
 *
 * The dev implementation writes to .tokens/ (gitignored). It is single-tenant
 * and process-local; it exists so a developer can complete a real OAuth round
 * trip without provisioning Postgres first, not to run a business on.
 */

export interface StoredGrant {
  channel: Channel;
  /** Encrypted. Never logged, never serialized to the client. */
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  /** Epoch millis. Null when the provider issues non-expiring tokens. */
  expiresAt: number | null;
  scopes: string[];
  /** Who the platform says this is — safe to display. */
  accountLabel: string;
  externalAccountId: string;
  connectedAt: number;
}

/** The safe projection: everything except the secrets. */
export interface GrantSummary {
  channel: Channel;
  scopes: string[];
  accountLabel: string;
  externalAccountId: string;
  connectedAt: number;
  expiresAt: number | null;
  expired: boolean;
  hasRefreshToken: boolean;
}

const DIR = join(process.cwd(), '.tokens');
const FILE = join(DIR, 'grants.json');

function readAll(): Record<string, StoredGrant> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, StoredGrant>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoredGrant>): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export function saveGrant(input: {
  channel: Channel;
  accessToken: string;
  refreshToken?: string | null;
  expiresInSec?: number | null;
  scopes: string[];
  accountLabel: string;
  externalAccountId: string;
}): void {
  const all = readAll();
  all[input.channel] = {
    channel: input.channel,
    accessTokenEnc: encrypt(input.accessToken),
    refreshTokenEnc: input.refreshToken ? encrypt(input.refreshToken) : null,
    expiresAt: input.expiresInSec ? Date.now() + input.expiresInSec * 1000 : null,
    scopes: input.scopes,
    accountLabel: input.accountLabel,
    externalAccountId: input.externalAccountId,
    connectedAt: Date.now(),
  };
  writeAll(all);
}

/** Decrypt for use by a publisher. Server-side callers only. */
export function getAccessToken(channel: Channel): string | null {
  const grant = readAll()[channel];
  if (!grant) return null;
  return decrypt(grant.accessTokenEnc);
}

export function getRefreshToken(channel: Channel): string | null {
  const grant = readAll()[channel];
  if (!grant?.refreshTokenEnc) return null;
  return decrypt(grant.refreshTokenEnc);
}

export function summaries(): GrantSummary[] {
  return Object.values(readAll()).map((g) => ({
    channel: g.channel,
    scopes: g.scopes,
    accountLabel: g.accountLabel,
    externalAccountId: g.externalAccountId,
    connectedAt: g.connectedAt,
    expiresAt: g.expiresAt,
    expired: g.expiresAt !== null && g.expiresAt < Date.now(),
    hasRefreshToken: g.refreshTokenEnc !== null,
  }));
}

export function removeGrant(channel: Channel): void {
  const all = readAll();
  delete all[channel];
  writeAll(all);
}
