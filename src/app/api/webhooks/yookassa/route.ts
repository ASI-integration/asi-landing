import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';
import { hasWebhookBeenProcessed, markWebhookProcessed } from '@/lib/payments/events';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const provider = getProvider('yookassa');
    const bodyText = await req.text();

    // YooKassa uses IP whitelisting; signature param is unused but kept for interface parity
    if (!provider.verifyWebhookSignature(bodyText, '')) {
      console.error('[YooKassa Webhook] Origin verification failed');
      return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
    }

    const { transactionId, status, eventId, rawEvent } = await provider.parseWebhookEvent(
      bodyText,
      ''
    );

    console.log(`[YooKassa Webhook] Received eventId=${eventId} tx=${transactionId} status=${status}`);

    // Idempotency: skip if already processed
    if (eventId && hasWebhookBeenProcessed('yookassa', eventId)) {
      console.log(`[YooKassa Webhook] Event ${eventId} already processed, skipping.`);
      return NextResponse.json({ received: true });
    }

    // ── Subscription payment path (dashboard billing) ──────────────────────────
    // Stack A creates payments via /api/yookassa/create-payment and embeds user_id
    // in metadata. Detect and handle those here so this is the single webhook path.
    const raw = rawEvent as { event?: string; object?: Record<string, unknown> };
    const paymentObj = raw?.object ?? {};
    const userId = (paymentObj.metadata as Record<string, string> | undefined)?.user_id;
    const paymentMethodId = (paymentObj.payment_method as Record<string, string> | undefined)?.id;

    if (userId && status === 'paid') {
      // Upsert payment record in Supabase
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('yookassa_payment_id', transactionId)
        .single();

      const amountRaw = (paymentObj.amount as { value?: string } | undefined)?.value;
      const amountCents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : 0;

      if (existing) {
        await supabase.from('payments').update({ status: 'succeeded' }).eq('yookassa_payment_id', transactionId);
      } else {
        await supabase.from('payments').insert({
          user_id: userId,
          yookassa_payment_id: transactionId,
          amount: amountCents,
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
          payment_method_id: paymentMethodId ?? null,
        })
        .eq('user_id', userId);

      const { data: user } = await supabase.from('users').select('email').eq('id', userId).single();
      await sendTelegramMessage(`✅ Subscription payment: ${user?.email ?? userId}`);

      if (eventId) markWebhookProcessed('yookassa', eventId);
      return NextResponse.json({ received: true });
    }

    // ── Operational / guest payment path (bot orchestrator) ────────────────────
    const payment = await getPaymentByTransactionId(transactionId);
    if (!payment) {
      console.warn(`[YooKassa Webhook] Unrecognized transaction ID ${transactionId}`);
      if (eventId) markWebhookProcessed('yookassa', eventId);
      return NextResponse.json({ received: true });
    }

    const updated = await updatePaymentStatus(transactionId, status);
    console.log(`[YooKassa Webhook] Status update tx=${transactionId} status=${status} changed=${updated}`);

    if (updated && status === 'paid' && payment.chatId) {
      await sendPaymentConfirmation({
        paymentId: payment.id,
        chatId: parseInt(payment.chatId, 10),
        amount: payment.amount,
        currency: payment.currency,
        serviceType: payment.serviceType,
      });
    }

    if (eventId) markWebhookProcessed('yookassa', eventId);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[YooKassa Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
