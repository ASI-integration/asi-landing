import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

async function resolveAccountIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.account_id as string | undefined) ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) {
    return NextResponse.json({ channels: [] });
  }

  const { data, error } = await supabase
    .from('channels')
    .select('id, type, status, external_id, settings_json, created_at, updated_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // Never expose sensitive provider tokens to the browser.
  const safe = (data ?? []).map((c: any) => {
    const settings = (c.settings_json && typeof c.settings_json === 'object') ? c.settings_json : {};
    const {
      access_token: _accessToken,
      refresh_token: _refreshToken,
      token: _token,
      ...rest
    } = settings as Record<string, unknown>;

    return {
      id: c.id,
      type: c.type,
      status: c.status,
      external_id: c.external_id ?? null,
      settings_json: rest,
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  });

  return NextResponse.json({ channels: safe });
}

