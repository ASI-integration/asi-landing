import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type PatchBody = {
  status?: 'connected' | 'disabled';
  disabled_reason?: string | null;
};

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  return { accountId };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.status === 'disabled') {
    patch.status = 'disabled';
    patch.disabled_reason = body.disabled_reason ?? 'manual_disable';
  } else if (body.status === 'connected') {
    patch.status = 'connected';
    patch.disabled_reason = null;
    patch.last_error = null;
  }

  const { data, error } = await supabase
    .from('dist_property_channel_connections')
    .update(patch)
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .select(
      'id, account_id, property_id, channel_id, ota_account_id, status, disabled_reason, last_success_at, last_attempt_at, last_error, last_sync_state_json, created_at, updated_at',
    )
    .maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ connection: data });
}

