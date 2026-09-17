import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';
import { readRequestJson } from '@/lib/safeRequestJson';
import { getIsRuHost } from '@/lib/getIsRuHost';

export async function POST(req: Request) {
  try {
    const parsed = await readRequestJson<{ email?: string; password?: string; plan?: unknown }>(req);
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { email, password, plan } = parsed.data;
    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, password_hash')
      .eq('email', emailLower)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    // On every login, ensureAccountForUser backfills an account for a user
    // who somehow doesn't have one yet (legacy/imported users). It must NOT
    // re-trigger the legacy immediate-trial write path for an existing
    // international account on repeat logins — deferTrial keeps the
    // membership-exists branch a no-op for trial fields, same as signup.
    const isRuHost = await getIsRuHost();
    await ensureAccountForUser(
      isRuHost
        ? { userId: user.id, email: user.email, selectedPlan: plan, trialDays: 7 }
        : { userId: user.id, email: user.email, selectedPlan: plan, deferTrial: true }
    );

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
