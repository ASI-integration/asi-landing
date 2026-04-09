import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type VkTokenResponse =
  | {
      access_token: string;
      expires_in: number;
      user_id: number;
      email?: string;
    }
  | {
      error: string;
      error_description?: string;
    };

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

async function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<VkTokenResponse> {
  const u = new URL('https://oauth.vk.com/access_token');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('client_secret', params.clientSecret);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('code', params.code);
  const res = await fetch(u.toString(), { method: 'GET' });
  const json = (await res.json()) as VkTokenResponse;
  return json;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const oauthErrorDesc = url.searchParams.get('error_description');

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId) {
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=account_missing', req.url));
  }

  const { data: channel, error: chErr } = await supabase
    .from('channels')
    .select('id, status, settings_json')
    .eq('account_id', accountId)
    .eq('type', 'vk')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (chErr) throw chErr;

  const settings =
    channel?.settings_json && typeof channel.settings_json === 'object'
      ? (channel.settings_json as Record<string, unknown>)
      : {};

  const expectedState = typeof settings.oauth_state === 'string' ? settings.oauth_state : null;

  const markError = async (reason: string) => {
    if (!channel?.id) return;
    await supabase
      .from('channels')
      .update({
        status: 'error',
        settings_json: {
          ...settings,
          last_error: reason,
          oauth_state: null,
          oauth_finished_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.id);
  };

  if (oauthError) {
    await markError(`${oauthError}${oauthErrorDesc ? `: ${oauthErrorDesc}` : ''}`);
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=oauth_denied', req.url));
  }

  if (!code || !state) {
    await markError('missing_code_or_state');
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=missing_params', req.url));
  }

  if (!expectedState || expectedState !== state) {
    await markError('state_mismatch');
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=state_mismatch', req.url));
  }

  const clientId = process.env.VK_CLIENT_ID;
  const clientSecret = process.env.VK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    await markError('vk_env_missing');
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=env_missing', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/connect/vk/callback`;
  const token = await exchangeCode({ clientId, clientSecret, redirectUri, code });

  if ('error' in token) {
    await markError(`${token.error}${token.error_description ? `: ${token.error_description}` : ''}`);
    return NextResponse.redirect(new URL('/dashboard?vk=error&reason=token_exchange_failed', req.url));
  }

  if (!channel?.id) {
    // In case the channel row was deleted mid-flow.
    const { error: insErr } = await supabase.from('channels').insert({
      account_id: accountId,
      type: 'vk',
      status: 'connected',
      external_id: String(token.user_id),
      settings_json: {
        access_token: token.access_token,
        expires_in: token.expires_in,
        user_id: token.user_id,
        oauth_state: null,
        oauth_finished_at: new Date().toISOString(),
        last_error: null,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (insErr) {
      return NextResponse.redirect(new URL('/dashboard?vk=error&reason=db_insert_failed', req.url));
    }
  } else {
    const { error: upErr } = await supabase
      .from('channels')
      .update({
        status: 'connected',
        external_id: String(token.user_id),
        settings_json: {
          ...settings,
          access_token: token.access_token,
          expires_in: token.expires_in,
          user_id: token.user_id,
          oauth_state: null,
          oauth_finished_at: new Date().toISOString(),
          last_error: null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.id);
    if (upErr) {
      return NextResponse.redirect(new URL('/dashboard?vk=error&reason=db_update_failed', req.url));
    }
  }

  return NextResponse.redirect(new URL('/dashboard?vk=connected', req.url));
}

