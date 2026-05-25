import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';
import { readRequestJson } from '@/lib/safeRequestJson';

function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '').slice(0, 24);
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let debug = false;
  try {
    const parsed = await readRequestJson<{ idToken?: string; plan?: unknown; debug?: boolean }>(req);
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const body = parsed.data;
    const { idToken, plan } = body;
    debug = Boolean(body?.debug);
    if (!idToken) {
      return NextResponse.json({ error: 'idToken required' }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: 'Google auth not configured' }, { status: 500 });
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const aud = payload?.aud;
    if (aud && aud !== clientId) {
      return NextResponse.json(
        { error: 'Google token audience mismatch', ...(debug ? { details: { expectedAud: clientId, receivedAud: aud } } : {}) },
        { status: 401 }
      );
    }
    const email = payload?.email?.toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Google account email missing' }, { status: 400 });
    }

    // Find existing user
    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    let userId = existing?.id as string | undefined;

    if (!userId) {
      // users.password_hash is NOT NULL; create a valid bcrypt hash for compatibility with email login.
      const passwordHash = await bcrypt.hash(randomPassword(), 10);
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({ email, password_hash: passwordHash })
        .select('id, email')
        .single();
      if (createErr) throw createErr;
      userId = created.id;

      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 7);
      await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          status: 'trial',
          trial_start: now.toISOString(),
          trial_end: trialEnd.toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }

    const session = await getSession();
    session.userId = userId!;
    session.email = email;
    await session.save();

    await ensureAccountForUser({
      userId: userId!,
      email,
      selectedPlan: plan,
      trialDays: 7,
    });

    return NextResponse.json({ ok: true, userId });
  } catch (err) {
    console.error('[GoogleAuth]', err);
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { error: 'Google login failed', ...(debug && typeof message === 'string' ? { details: message } : {}) },
      { status: 500 }
    );
  }
}

