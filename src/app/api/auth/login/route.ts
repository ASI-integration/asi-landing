import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';

const DEMO_EMAIL = (process.env.DEMO_LOGIN_EMAIL ?? 'demo@asi-global.ru').toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_LOGIN_PASSWORD ?? 'asi-demo-2026';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Введите email и пароль' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();

    // Demo-only access — no database lookup needed
    if (emailLower === DEMO_EMAIL && password === DEMO_PASSWORD) {
      const session = await getSession();
      session.userId = 'demo-user';
      session.email = DEMO_EMAIL;
      await session.save();
      return NextResponse.json({ ok: true, userId: 'demo-user' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, password_hash')
      .eq('email', emailLower)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 });
    }

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
