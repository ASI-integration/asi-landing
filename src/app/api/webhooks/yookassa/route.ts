import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';
import { hasWebhookBeenProcessed, markWebhookProcessed } from '@/lib/payments/events';

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

    const payment = await getPaymentByTransactionId(transactionId);
    if (!payment) {
      console.warn(`[YooKassa Webhook] Unrecognized transaction ID ${transactionId}`);
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
