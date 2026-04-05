import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { legalConfig } from '@/config/legal';
import { getYooKassaCredentials, getYooKassaReturnUrl } from '@/lib/payments/yookassa-env';

const PAYMENT_DESCRIPTION = 'ASI — Autopilot plan subscription';
/** Seller line on receipt item (no tax IDs in global product copy). */
const RECEIPT_SELLER = legalConfig.name;

export async function POST(req: Request) {
  const creds = getYooKassaCredentials();
  if (!creds) {
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 });
  }

  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { amount: amountCents = 99000 } = await req.json();
    const amountStr = (amountCents / 100).toFixed(2);

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('email')
      .eq('id', session.userId)
      .single();

    if (userErr || !userRow?.email) {
      console.error('[payments/create] user email for receipt', userErr);
      return NextResponse.json(
        { error: 'Profile email is required to issue a receipt' },
        { status: 400 }
      );
    }

    const auth = Buffer.from(`${creds.shopId}:${creds.secretKey}`).toString('base64');
    const idempotenceKey = randomUUID();

    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify({
        amount: { value: amountStr, currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: getYooKassaReturnUrl(),
        },
        capture: true,
        description: PAYMENT_DESCRIPTION,
        save_payment_method: true,
        metadata: { user_id: session.userId, userId: session.userId },
        receipt: {
          customer: { email: userRow.email },
          items: [
            {
              description: `${PAYMENT_DESCRIPTION} (${RECEIPT_SELLER})`,
              quantity: 1,
              amount: { value: amountStr, currency: 'RUB' },
              vat_code: 6,
              payment_mode: 'full_payment',
              payment_subject: 'service',
            },
          ],
          internet: 'true',
          timezone: 3,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[payments/create] YooKassa API', res.status, err);
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    const data = (await res.json()) as {
      id: string;
      status: string;
      confirmation?: { confirmation_url?: string };
    };

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
    console.error('[payments/create]', err);
    return NextResponse.json({ error: 'Payment failed' }, { status: 500 });
  }
}
