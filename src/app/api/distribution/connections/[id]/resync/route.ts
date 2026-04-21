import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type ResyncBody = {
  kind?: string;
  idempotency_key?: string;
};

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  return { accountId, userId: session.userId };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as ResyncBody | null;
  const kind = body?.kind && typeof body.kind === 'string' ? body.kind : 'full_resync';
  const idempotencyKey =
    body?.idempotency_key && typeof body.idempotency_key === 'string' ? body.idempotency_key : null;

  // Ensure connection exists and is scoped to account. If disabled, allow resync request but keep job queued.
  const { data: conn, error: connErr } = await supabase
    .from('dist_property_channel_connections')
    .select('id, status')
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (connErr) throw connErr;
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (idempotencyKey) {
    const existing = await supabase
      .from('dist_sync_jobs')
      .select('id, status, kind, created_at')
      .eq('account_id', auth.accountId)
      .eq('connection_id', id)
      .eq('idempotency_key', idempotencyKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing.error && existing.data) {
      return NextResponse.json({ job: existing.data, deduped: true });
    }
    if (existing.error) throw existing.error;
  }

  const { data: job, error } = await supabase
    .from('dist_sync_jobs')
    .insert({
      account_id: auth.accountId,
      connection_id: id,
      kind,
      requested_by: `user:${auth.userId}`,
      status: 'queued',
      idempotency_key: idempotencyKey,
      attempt_count: 0,
      next_run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id, status, kind, requested_by, idempotency_key, attempt_count, next_run_at, created_at, updated_at')
    .single();
  if (error) throw error;

  return NextResponse.json({ job, deduped: false });
}

