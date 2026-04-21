import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type UpsertRatePlanBody = {
  internal_rate_plan_key: string;
  external_rate_plan_id: string;
  currency?: string | null;
  metadata_json?: Record<string, unknown>;
};

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  return { accountId };
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;
  const { id } = await ctx.params;

  const conn = await supabase
    .from('dist_property_channel_connections')
    .select('id')
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (conn.error) throw conn.error;
  if (!conn.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('dist_rate_plans')
    .select('id, internal_rate_plan_key, external_rate_plan_id, currency, metadata_json, created_at, updated_at')
    .eq('connection_id', id)
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return NextResponse.json({ rate_plans: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as UpsertRatePlanBody | null;
  if (!body?.internal_rate_plan_key || !body?.external_rate_plan_id) {
    return NextResponse.json(
      { error: 'internal_rate_plan_key and external_rate_plan_id required' },
      { status: 400 },
    );
  }

  const conn = await supabase
    .from('dist_property_channel_connections')
    .select('id')
    .eq('id', id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (conn.error) throw conn.error;
  if (!conn.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('dist_rate_plans')
    .upsert(
      {
        account_id: auth.accountId,
        connection_id: id,
        internal_rate_plan_key: body.internal_rate_plan_key,
        external_rate_plan_id: body.external_rate_plan_id,
        currency: body.currency ?? null,
        metadata_json: body.metadata_json ?? {},
        updated_at: now,
      },
      { onConflict: 'connection_id,internal_rate_plan_key' },
    )
    .select('id, internal_rate_plan_key, external_rate_plan_id, currency, metadata_json, created_at, updated_at')
    .single();
  if (error) throw error;

  return NextResponse.json({ rate_plan: data });
}

