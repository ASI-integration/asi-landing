import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/events';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { SessionStatus, transitionSessionStatus } from '@/lib/communication/session-status';
import { isYooKassaEnabled, YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

/**
 * Общая обработка уведомлений ЮKassa.
 * Доступно как POST /api/webhooks/yookassa и POST /api/payments/webhook.
 */
export async function handleYookassaWebhook(req: Request): Promise<NextResponse> {
  let claimedEventId: string | undefined;
  try {
    if (!isYooKassaEnabled()) {
      return NextResponse.json({
        received: false,
        handled: false,
        status: 'disabled',
        message: YOOKASSA_PENDING_REVIEW_MESSAGE,
      }, { status: 503 });
    }

    if (!isYooKassaWebhookSourceVerified(req)) {
      console.error('[YooKassa Webhook] Trusted source verification unavailable');
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }

    const provider = getProvider('yookassa');
    const bodyText = await req.text();

    const { transactionId, status, eventId, rawEvent } = await provider.parseWebhookEvent(
      bodyText,
      ''
    );

    const raw = rawEvent as { event?: string; object?: Record<string, unknown> };
    console.log(
      `[YooKassa Webhook] event=${raw?.event ?? '?'} eventId=${eventId} tx=${transactionId} status=${status}`
    );

    if (eventId && !(await claimWebhookEvent('yookassa', eventId))) {
      console.log(`[YooKassa Webhook] Event ${eventId} already processed, skipping.`);
      return NextResponse.json({ received: true });
    }
    claimedEventId = eventId;

    // Подписка (дашборд): metadata.user_id или metadata.userId из /api/payments/create
    const paymentObj = raw?.object ?? {};
    const meta = paymentObj.metadata as Record<string, string> | undefined;
    const userId = meta?.user_id || meta?.userId;
    const paymentMethodId = (paymentObj.payment_method as Record<string, string> | undefined)?.id;

    const isSubscriptionSuccess =
      raw?.event === 'payment.succeeded' && userId && status === 'paid';

    if (isSubscriptionSuccess) {
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
      const { error: subError } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          current_period_end: periodEnd.toISOString(),
          payment_method_id: paymentMethodId ?? null,
        })
        .eq('user_id', userId);

      if (subError) {
        console.error('[YooKassa Webhook] subscriptions update failed', subError);
      } else {
        console.log(`[YooKassa Webhook] payment.succeeded → subscription active user_id=${userId}`);
      }

      const { data: user } = await supabase.from('users').select('email').eq('id', userId).single();
      await sendTelegramMessage(`✅ Subscription payment: ${user?.email ?? userId}`);

      return NextResponse.json({ received: true });
    }

    const payment = await getPaymentByTransactionId(transactionId);
    if (!payment) {
      console.warn(`[YooKassa Webhook] Unrecognized transaction ID ${transactionId}`);
      return NextResponse.json({ received: true });
    }

    const updated = await updatePaymentStatus(transactionId, status);
    console.log(`[YooKassa Webhook] Status update tx=${transactionId} status=${status} changed=${updated}`);

    if (status === 'paid' && payment.chatId) {
      const numericChatId = parseInt(payment.chatId, 10);
      await sendPaymentConfirmation({
        paymentId: payment.id,
        chatId: numericChatId,
        amount: payment.amount,
        currency: payment.currency,
        serviceType: payment.serviceType,
      });
      await transitionSessionStatus(numericChatId, SessionStatus.Paid);
    }

    if (updated && status === 'cancelled' && payment.chatId) {
      await transitionSessionStatus(parseInt(payment.chatId, 10), SessionStatus.Cancelled);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    if (claimedEventId) await releaseWebhookEvent('yookassa', claimedEventId);
    console.error('[YooKassa Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

/**
 * Next.js' standard Request does not expose the transport peer address. Forwarded
 * IP headers are client-controlled unless a trusted proxy overwrites them, and
 * this route has no such verified contract. Keep the boundary closed until the
 * server adapter supplies a trustworthy peer address.
 */
export function isYooKassaWebhookSourceVerified(_req: Request): boolean {
  return false;
}
