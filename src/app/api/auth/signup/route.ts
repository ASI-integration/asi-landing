import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({ email: emailLower, password_hash: passwordHash })
      .select('id, email')
      .single();

    if (userError) {
      if (userError.code === '23505') {
        return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
      }
      throw userError;
    }

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { error: subError } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      status: 'trial',
      trial_start: now.toISOString(),
      trial_end: trialEnd.toISOString(),
    });

    if (subError) throw subError;

    await sendTelegramMessage(`🆕 New trial user registered: ${user.email}`);

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Signup]', err);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
