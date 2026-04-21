import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type AvailabilityPatch = {
  listing_id?: string | null;
  day: string; // YYYY-MM-DD
  available_units: number;
  closed?: boolean;
  min_los?: number | null;
  max_los?: number | null;
  cutoff_days?: number | null;
};

type Body = {
  idempotency_key?: string;
  updates: AvailabilityPatch[];
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

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json({ error: 'updates[] required' }, { status: 400 });
  }

  const conn = await supabase
    .from('dist_property_channel_connections')
    .select('id, account_id, status')
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (conn.error) throw conn.error;
  if (!conn.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (conn.data.status === 'disabled') return NextResponse.json({ error: 'Connection disabled' }, { status: 409 });

  const now = new Date().toISOString();

  const idemKey =
    body.idempotency_key && typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : null;
  if (idemKey) {
    const existing = await supabase
      .from('dist_idempotency_keys')
      .select('id')
      .eq('scope', 'availability_push')
      .eq('connection_id', id)
      .eq('key', idemKey)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      await supabase.from('dist_sync_events').insert({
        account_id: auth.accountId,
        connection_id: id,
        direction: 'outbound',
        kind: 'availability_push',
        request_json: { idempotency_key: idemKey, deduped: true },
        response_json: { ok: true, deduped: true },
        status: 'ok',
        started_at: now,
        finished_at: now,
        created_at: now,
      });
      return NextResponse.json({ ok: true, deduped: true });
    }

    const { error: idemErr } = await supabase.from('dist_idempotency_keys').insert({
      account_id: auth.accountId,
      connection_id: id,
      scope: 'availability_push',
      key: idemKey,
      first_seen_at: now,
      last_seen_at: now,
    });
    if (idemErr) throw idemErr;
  }

  const rows = body.updates.map(u => ({
    account_id: auth.accountId,
    connection_id: id,
    listing_id: u.listing_id ?? null,
    day: u.day,
    available_units: u.available_units,
    closed: Boolean(u.closed),
    min_los: u.min_los ?? null,
    max_los: u.max_los ?? null,
    cutoff_days: u.cutoff_days ?? null,
    updated_from: `api:user:${auth.userId}`,
    updated_at: now,
  }));

  const { error } = await supabase.from('dist_availability_days').upsert(rows, {
    onConflict: 'connection_id,listing_id,day',
  });
  if (error) throw error;

  await supabase.from('dist_sync_events').insert({
    account_id: auth.accountId,
    connection_id: id,
    direction: 'outbound',
    kind: 'availability_push',
    request_json: { idempotency_key: body.idempotency_key ?? null, updates: body.updates },
    response_json: { ok: true, upserted: rows.length },
    status: 'ok',
    started_at: now,
    finished_at: now,
    created_at: now,
  });

  await supabase
    .from('dist_property_channel_connections')
    .update({ last_attempt_at: now, last_success_at: now, last_error: null, updated_at: now })
    .eq('id', id)
    .eq('account_id', auth.accountId);

  return NextResponse.json({ ok: true, upserted: rows.length });
}

