import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { buildChannelConnectionsFoundationSnapshot } from '@/lib/channel-connections';

export const runtime = 'nodejs';

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) {
    return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  }
  return { accountId };
}

/**
 * Foundation read API — catalog and workspace snapshot only.
 * No provider credentials or external API calls.
 */
export async function GET() {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const snapshot = buildChannelConnectionsFoundationSnapshot(auth.accountId);
  return NextResponse.json(snapshot);
}
