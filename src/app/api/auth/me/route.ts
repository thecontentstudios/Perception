import { NextResponse } from 'next/server';
import { currentPrincipal } from '@/lib/auth/session';
import { dbAvailable } from '@/lib/db';
import { can, type Capability } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

const CAPABILITIES: Capability[] = [
  'read', 'create_content', 'approve', 'publish', 'manage_connections', 'manage_org',
];

/**
 * Who am I, and what may I do.
 *
 * The capability list is sent so the UI can hide what the caller cannot use.
 * That is a *courtesy*, not a control — every one of those capabilities is
 * enforced again on the server, because a hidden button is still a request
 * anybody can make by hand.
 */
export async function GET() {
  if (!(await dbAvailable())) {
    return NextResponse.json({ authenticated: false, reason: 'no-database' });
  }

  const principal = await currentPrincipal();
  if (!principal) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    user: { id: principal.userId, name: principal.name, email: principal.email },
    organizationId: principal.organizationId,
    role: principal.role,
    capabilities: CAPABILITIES.filter((c) => can(principal.role, c)),
  });
}
