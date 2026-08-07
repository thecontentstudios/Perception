import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton.
 *
 * Next.js hot-reload re-evaluates modules on every edit; without caching the
 * client on globalThis you accumulate a new connection pool per reload and
 * exhaust Postgres within a few minutes of editing.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

/** True when a DATABASE_URL is configured and reachable. */
export async function dbAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
