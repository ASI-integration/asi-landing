import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';
import { redactSecrets } from '@/lib/distribution/redact';

export const runtime = 'nodejs';

type CreateOrUpdateConnectionBody = {
  property_id: string;
  channel_code: string;
  /** Optional: create/update an OTA account config in same call */
  ota_account?: {
    nickname?: string | null;
    external_id?: string | null;
    config_json?: Record<string, unknown>;
  };
  /** Optional: attach existing OTA account */
  ota_account_id?: string | null;
};

async function requireAccountId() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) return { error: NextResponse.json({ error: 'Account not found' }, { status: 400 }) };
  return { accountId };
}

export async function GET() {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const { data, error } = await supabase
    .from('dist_property_channel_connections')
    .select(
      [
        'id',
        'account_id',
        'property_id',
        'channel_id',
        'ota_account_id',
        'status',
        'disabled_reason',
        'last_success_at',
        'last_attempt_at',
        'last_error',
        'last_sync_state_json',
        'created_at',
        'updated_at',
      ].join(', '),
    )
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return NextResponse.json({ connections: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAccountId();
  if ('error' in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as CreateOrUpdateConnectionBody | null;
  if (!body?.property_id || !body?.channel_code) {
    return NextResponse.json({ error: 'property_id and channel_code required' }, { status: 400 });
  }

  // Resolve channel by code (canonical catalog)
  const { data: channel, error: chErr } = await supabase
    .from('dist_distribution_channels')
    .select('id, code, name, status')
    .eq('code', body.channel_code)
    .limit(1)
    .maybeSingle();
  if (chErr) throw chErr;
  if (!channel?.id) return NextResponse.json({ error: 'Unknown channel_code' }, { status: 400 });
  if (channel.status !== 'active') return NextResponse.json({ error: 'Channel inactive' }, { status: 409 });

  // Verify property belongs to account (no cross-account corruption)
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id')
    .eq('id', body.property_id)
    .eq('account_id', auth.accountId)
    .limit(1)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop?.id) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  // Optionally upsert an OTA account for the channel.
  let otaAccountId: string | null = body.ota_account_id ?? null;
  if (body.ota_account) {
    const configJson = body.ota_account.config_json ?? {};
    const { data: existing, error: exErr } = await supabase
      .from('dist_ota_accounts')
      .select('id')
      .eq('account_id', auth.accountId)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('dist_ota_accounts')
        .update({
          nickname: body.ota_account.nickname ?? null,
          external_id: body.ota_account.external_id ?? null,
          config_json: configJson,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('account_id', auth.accountId);
      if (upErr) throw upErr;
      otaAccountId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('dist_ota_accounts')
        .insert({
          account_id: auth.accountId,
          channel_id: channel.id,
          nickname: body.ota_account.nickname ?? null,
          external_id: body.ota_account.external_id ?? null,
          config_json: configJson,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      otaAccountId = inserted.id;
    }
  }

  // Upsert connection (unique by property_id + channel_id)
  const now = new Date().toISOString();
  const { data: conn, error: connErr } = await supabase
    .from('dist_property_channel_connections')
    .upsert(
      {
        account_id: auth.accountId,
        property_id: body.property_id,
        channel_id: channel.id,
        ota_account_id: otaAccountId,
        status: 'connected',
        disabled_reason: null,
        last_error: null,
        updated_at: now,
      },
      { onConflict: 'property_id,channel_id' },
    )
    .select(
      'id, account_id, property_id, channel_id, ota_account_id, status, disabled_reason, last_success_at, last_attempt_at, last_error, last_sync_state_json, created_at, updated_at',
    )
    .single();
  if (connErr) throw connErr;

  const safeOtaAccount =
    otaAccountId
      ? await supabase
          .from('dist_ota_accounts')
          .select('id, nickname, external_id, status, config_json, created_at, updated_at')
          .eq('id', otaAccountId)
          .eq('account_id', auth.accountId)
          .maybeSingle()
      : null;

  if (safeOtaAccount?.error) throw safeOtaAccount.error;

  return NextResponse.json({
    connection: conn,
    ota_account: safeOtaAccount?.data
      ? { ...safeOtaAccount.data, config_json: redactSecrets((safeOtaAccount.data as any).config_json) }
      : null,
  });
}

