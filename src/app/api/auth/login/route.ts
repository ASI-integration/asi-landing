import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { ensureAccountForUser } from '@/lib/accounts';

export async function POST(req: Request) {
  try {
    const { email, password, plan } = await req.json();
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

    await ensureAccountForUser({
      userId: user.id,
      email: user.email,
      selectedPlan: plan,
      trialDays: 7,
    });

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
