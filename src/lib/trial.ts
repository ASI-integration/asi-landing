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
      // YooKassa recurring payments are disabled until the report product is reviewed.
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
  void userId;
  void paymentMethodId;
  return false;
}
