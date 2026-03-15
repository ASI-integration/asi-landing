import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { sendTelegramMessage } from '@/lib/telegram';

function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '').slice(0, 24);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      email,
      phone = '',
      telegram = '',
      objectsCount = '',
      comment = '',
    } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();
    const password = randomPassword();
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

    const leadLines = [
      '🆕 New onboarding / connection request',
      `Name: ${String(name).trim()}`,
      `Email: ${user.email}`,
      ...(phone ? [`Phone: ${String(phone).trim()}`] : []),
      ...(telegram ? [`Telegram: ${String(telegram).trim()}`] : []),
      ...(objectsCount ? [`Objects: ${String(objectsCount).trim()}`] : []),
      ...(comment ? [`Comment: ${String(comment).trim()}`] : []),
    ];
    await sendTelegramMessage(leadLines.join('\n'));

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error('[Onboarding]', err);
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 });
  }
}
