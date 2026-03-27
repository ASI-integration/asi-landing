/**
 * One-shot admin route: upsert the demo user with a fresh password hash.
 *
 * POST /api/admin/reset-demo-user
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Creates or resets demo@asi-global.ru with a known password.
 * Also ensures a valid active subscription row exists.
 *
 * Returns: 200 { ok: true, email, created: boolean }
 */

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';

const DEMO_EMAIL    = 'demo@asi-global.ru';
const DEMO_PASSWORD = 'AsiDemo2026!';

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── Check if user already exists ─────────────────────────────────────────
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', DEMO_EMAIL)
    .maybeSingle();

  let userId: string;
  const created = !existing;

  if (existing) {
    // Update password hash only
    const { error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('email', DEMO_EMAIL);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    userId = (existing as { id: string }).id;
  } else {
    // Insert new user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email: DEMO_EMAIL, password_hash: passwordHash })
      .select('id')
      .single();
    if (error || !newUser) {
      return NextResponse.json({ ok: false, error: error?.message ?? 'insert failed' }, { status: 500 });
    }
    userId = (newUser as { id: string }).id;
  }

  // ── Ensure subscription row exists (active, no expiry) ────────────────────
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!existingSub) {
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setFullYear(trialEnd.getFullYear() + 10); // 10-year demo
    await supabase.from('subscriptions').insert({
      user_id:    userId,
      status:     'active',
      trial_start: now.toISOString(),
      trial_end:  trialEnd.toISOString(),
    });
  } else {
    // Make sure status is active
    await supabase
      .from('subscriptions')
      .update({ status: 'active' })
      .eq('user_id', userId);
  }

  return NextResponse.json({ ok: true, email: DEMO_EMAIL, created });
}
