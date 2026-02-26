import { supabase } from './supabase';
import { sendTelegramMessage } from './telegram';

export async function checkTrialExpiration(): Promise<void> {
  const now = new Date().toISOString();

  const { data: subs } = await supabase
    .from('subscriptions')
    .select('id, user_id, payment_method_id')
    .eq('status', 'trial')
    .lt('trial_end', now);

  if (!subs?.length) return;

  for (const sub of subs) {
    if (sub.payment_method_id) {
      // Attempt recurring payment via YooKassa
      const success = await attemptRecurringPayment(sub.user_id, sub.payment_method_id);
      if (success) {
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + 30);
        await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            current_period_end: periodEnd.toISOString(),
          })
          .eq('id', sub.id);

        const { data: user } = await supabase.from('users').select('email').eq('id', sub.user_id).single();
        await sendTelegramMessage(`✅ Trial → Active (recurring): ${user?.email ?? sub.user_id}`);
      } else {
        await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);
        const { data: user } = await supabase.from('users').select('email').eq('id', sub.user_id).single();
        await sendTelegramMessage(`❌ Trial expired, payment failed: ${user?.email ?? sub.user_id}`);
      }
    } else {
      await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);
      const { data: user } = await supabase.from('users').select('email').eq('id', sub.user_id).single();
      await sendTelegramMessage(`⚠️ Trial expired (no payment method): ${user?.email ?? sub.user_id}`);
    }
  }
}

async function attemptRecurringPayment(userId: string, paymentMethodId: string): Promise<boolean> {
  const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET_KEY;
  const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
  if (!YOOKASSA_SECRET || !YOOKASSA_SHOP_ID) return false;

  try {
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET}`).toString('base64');
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': `recurring-${userId}-${Date.now()}`,
      },
      body: JSON.stringify({
        amount: { value: '990.00', currency: 'RUB' },
        payment_method_id: paymentMethodId,
        capture: true,
        description: 'ASI subscription renewal',
      }),
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'succeeded';
  } catch {
    return false;
  }
}
