import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';
import { processYooKassaPaymentEvent } from '@/lib/payments/process-yookassa-event';
import { isYooKassaEnabled, YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';
import { SessionStatus, transitionSessionStatus } from '@/lib/communication/session-status';
import { claimPaymentConfirmation } from '@/lib/payments/events';

/**
 * Canonical YooKassa notification handler.
 * Available as POST /api/webhooks/yookassa and POST /api/payments/webhook.
 *
 * Trust model:
 * - webhook payload is a hint only
 * - authoritative status/amount/currency come from GET /payments/{id}
 * - redirect return URLs are never treated as payment proof
 */
export async function handleYookassaWebhook(req: Request): Promise<NextResponse> {
  try {
    if (!isYooKassaEnabled()) {
      return NextResponse.json(
        {
          received: false,
          handled: false,
          status: 'disabled',
          message: YOOKASSA_PENDING_REVIEW_MESSAGE,
        },
        { status: 503 },
      );
    }

    const provider = getProvider('yookassa');
    const bodyText = await req.text();
    const { transactionId, eventId, rawEvent } = await provider.parseWebhookEvent(bodyText, '');

    const raw = rawEvent as { event?: string };
    console.info(
      `[YooKassa Webhook] event=${raw?.event ?? '?'} eventId=${eventId ?? 'n/a'} tx=${transactionId}`,
    );

    if (!eventId) {
      return NextResponse.json({ error: 'Malformed event' }, { status: 400 });
    }

    const result = await processYooKassaPaymentEvent({
      eventType: raw?.event ?? 'unknown',
      eventId,
      providerPaymentId: transactionId,
    });

    if (!result.ok) {
      console.warn(`[YooKassa Webhook] rejected reason=${result.reason} tx=${transactionId}`);
      // Fail closed for unknown/mismatch; provider may retry.
      return NextResponse.json({ error: result.reason ?? 'rejected' }, { status: 409 });
    }

    if (result.status === 'paid' && result.paymentId) {
      const payment = await getPaymentByTransactionId(transactionId);
      if (payment?.chatId) {
        const claimed = await claimPaymentConfirmation(`notify:${payment.id}`);
        if (claimed) {
          const numericChatId = parseInt(payment.chatId, 10);
          if (!Number.isNaN(numericChatId)) {
            await sendPaymentConfirmation({
              paymentId: payment.id,
              chatId: numericChatId,
              amount: payment.amount,
              currency: payment.currency,
              serviceType: payment.serviceType,
            });
            await transitionSessionStatus(numericChatId, SessionStatus.Paid);
          }
        }
      }
    }

    if (result.status === 'cancelled') {
      const payment = await getPaymentByTransactionId(transactionId);
      if (payment?.chatId) {
        const numericChatId = parseInt(payment.chatId, 10);
        if (!Number.isNaN(numericChatId)) {
          await transitionSessionStatus(numericChatId, SessionStatus.Cancelled);
        }
      }
    }

    return NextResponse.json({ received: true, handled: result.handled });
  } catch (err) {
    console.error('[YooKassa Webhook Error]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
