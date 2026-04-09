import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { sendTelegramMessage } from '@/lib/telegram';
import { ensureAccountForUser } from '@/lib/accounts';

export async function POST(req: Request) {
  let createdUserId: string | null = null;
  let debug = false;
  try {
    const body = (await req.json()) as { email?: string; password?: string; plan?: unknown; debug?: boolean };
    const { email, password, plan } = body;
    debug = Boolean(body?.debug);
    if (!email?.trim() || !password) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'Укажите email и пароль.' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'WEAK_PASSWORD', message: 'Пароль должен быть минимум 6 символов.' },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: 'EMAIL_TAKEN', message: 'Этот email уже зарегистрирован. Войдите, пожалуйста.' },
          { status: 409 }
        );
      }
      throw userError;
    }
    createdUserId = user.id;

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 7);

    const { error: subError } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      status: 'trial',
      trial_start: now.toISOString(),
      trial_end: trialEnd.toISOString(),
    });

    if (subError) throw subError;

    await sendTelegramMessage(`🆕 New trial user registered: ${user.email}`);

    await ensureAccountForUser({
      userId: user.id,
      email: user.email,
      selectedPlan: plan,
      trialDays: 7,
    });

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Signup]', err);
    const details = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    // Best-effort cleanup: avoid leaving orphan users if later steps fail (e.g. missing migrations).
    if (createdUserId) {
      try {
        await supabase.from('subscriptions').delete().eq('user_id', createdUserId);
      } catch (cleanupErr) {
        console.error('[Signup] cleanup subscriptions failed', cleanupErr);
      }
      try {
        await supabase.from('users').delete().eq('id', createdUserId);
      } catch (cleanupErr) {
        console.error('[Signup] cleanup user failed', cleanupErr);
      }
    }
    return NextResponse.json(
      {
        error: 'SIGNUP_FAILED',
        message: 'Не удалось зарегистрировать аккаунт. Попробуйте ещё раз позже или напишите в поддержку.',
        ...(debug ? { details } : {}),
      },
      { status: 500 }
    );
  }
}
