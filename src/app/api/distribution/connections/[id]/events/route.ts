import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  return { accountId };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const { id } = await ctx.params;

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitRaw ?? '25', 10) || 25, 1), 200);

  const conn = await supabase
    .from('dist_property_channel_connections')
    .select('id')
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (conn.error) throw conn.error;
  if (!conn.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('dist_sync_events')
    .select(
      [
        'id',
        'job_id',
        'direction',
        'kind',
        'status',
        'error_message',
        'started_at',
        'finished_at',
        'created_at',
        'request_json',
        'response_json',
      ].join(', '),
    )
    .eq('connection_id', id)
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return NextResponse.json({ events: data ?? [], limit });
}

