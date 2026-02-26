import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET_KEY;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(req: Request) {
  if (!YOOKASSA_SECRET || !YOOKASSA_SHOP_ID) {
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 });
  }

  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { amount = 990 } = await req.json();
    const amountStr = (amount / 100).toFixed(2);

    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET}`).toString('base64');
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': `pay-${session.userId}-${Date.now()}`,
      },
      body: JSON.stringify({
        amount: { value: amountStr, currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: `${APP_URL}/dashboard?payment=success`,
        },
        capture: true,
        description: 'ASI subscription',
        save_payment_method: true,
        metadata: { user_id: session.userId },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[YooKassa create]', err);
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    const data = await res.json();

    await supabase.from('payments').insert({
      user_id: session.userId,
      yookassa_payment_id: data.id,
      amount: Math.round(parseFloat(amountStr) * 100),
      status: data.status,
    });

    const confirmationUrl = data.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      return NextResponse.json({ error: 'No confirmation URL' }, { status: 500 });
    }

    return NextResponse.json({ confirmation_url: confirmationUrl });
  } catch (err) {
    console.error('[YooKassa create]', err);
    return NextResponse.json({ error: 'Payment failed' }, { status: 500 });
  }
}
