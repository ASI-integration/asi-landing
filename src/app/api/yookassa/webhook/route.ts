import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.event !== 'payment.succeeded') {
      return NextResponse.json({ received: true });
    }

    const payment = body.object;
    const paymentId = payment.id;
    const userId = payment.metadata?.user_id;
    const paymentMethodId = payment.payment_method?.id;

    if (!userId) {
      console.warn('[YooKassa webhook] No user_id in metadata');
      return NextResponse.json({ received: true });
    }

    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('yookassa_payment_id', paymentId)
      .single();

    if (existing) {
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('yookassa_payment_id', paymentId);
    } else {
      const amount = payment.amount?.value ? Math.round(parseFloat(payment.amount.value) * 100) : 0;
      await supabase.from('payments').insert({
        user_id: userId,
        yookassa_payment_id: paymentId,
        amount,
        status: 'succeeded',
      });
    }

    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        current_period_end: periodEnd.toISOString(),
        payment_method_id: paymentMethodId || null,
      })
      .eq('user_id', userId);

    const { data: user } = await supabase.from('users').select('email').eq('id', userId).single();
    await sendTelegramMessage(`✅ Successful payment: ${user?.email ?? userId}`);

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[YooKassa webhook]', err);
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 });
  }
}
