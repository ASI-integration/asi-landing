import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';
import { hasWebhookBeenProcessed, markWebhookProcessed } from '@/lib/payments/events';
import { SessionStatus, transitionSessionStatus } from '@/lib/communication/session-status';

export async function POST(req: Request) {
  try {
    const provider = getProvider('stripe');
    const signature = req.headers.get('stripe-signature') || '';
    const bodyText = await req.text();

    if (!provider.verifyWebhookSignature(bodyText, signature)) {
      console.error('[Stripe Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const { transactionId, status, eventId, rawEvent } = await provider.parseWebhookEvent(
      bodyText,
      signature
    );

    console.log(`[Stripe Webhook] Received event=${eventId} tx=${transactionId} status=${status}`);

    // Idempotency: skip if this exact event was already processed
    if (eventId && hasWebhookBeenProcessed('stripe', eventId)) {
      console.log(`[Stripe Webhook] Event ${eventId} already processed, skipping.`);
      return NextResponse.json({ received: true });
    }

    const payment = await getPaymentByTransactionId(transactionId);
    if (!payment) {
      console.warn(`[Stripe Webhook] Unrecognized transaction ID ${transactionId}`);
      return NextResponse.json({ received: true });
    }

    const updated = await updatePaymentStatus(transactionId, status);
    console.log(`[Stripe Webhook] Status update tx=${transactionId} status=${status} changed=${updated}`);

    if (updated && status === 'paid' && payment.chatId) {
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

    if (eventId) markWebhookProcessed('stripe', eventId);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
