import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

function vkAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}): string {
  const u = new URL('https://oauth.vk.com/authorize');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('display', 'page');
  u.searchParams.set('scope', opts.scope);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('v', '5.131');
  return u.toString();
}

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

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const clientId = process.env.VK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'VK_CLIENT_ID not configured' }, { status: 500 });
  }

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/connect/vk/callback`;
  const state = crypto.randomUUID();

  const { data: existing, error: existingErr } = await supabase
    .from('channels')
    .select('id, settings_json')
    .eq('account_id', accountId)
    .eq('type', 'vk')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingErr) throw existingErr;

  const prevSettings =
    existing?.settings_json && typeof existing.settings_json === 'object'
      ? (existing.settings_json as Record<string, unknown>)
      : {};

  const nextSettings = {
    ...prevSettings,
    oauth_state: state,
    oauth_started_at: new Date().toISOString(),
    last_error: null,
  };

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from('channels')
      .update({
        status: 'pending',
        settings_json: nextSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase.from('channels').insert({
      account_id: accountId,
      type: 'vk',
      status: 'pending',
      settings_json: nextSettings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (insErr) throw insErr;
  }

  // Minimal scopes for v1 connection. You may need to adjust based on your VK app type.
  const scope = 'messages,groups,offline';
  const url = vkAuthorizeUrl({ clientId, redirectUri, state, scope });
  return NextResponse.redirect(url);
}

