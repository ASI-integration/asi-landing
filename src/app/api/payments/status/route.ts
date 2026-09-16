import { NextResponse } from 'next/server';
import { getPaymentById } from '@/lib/payments/db';
import { processYooKassaPaymentEvent } from '@/lib/payments/process-yookassa-event';

/**
 * Server-side payment status for the return page.
 * Query params are never treated as proof of payment.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('paymentId')?.trim();
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 });
  }

  // Reject obvious client-forged paid flags if present in query.
  if (url.searchParams.get('paid') === 'true' || url.searchParams.get('status') === 'succeeded') {
    // Still ignore them — status comes only from stored/provider-verified state.
  }

  let payment = await getPaymentById(paymentId);
  if (!payment) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  if (
    payment.provider === 'yookassa' &&
    payment.providerTransactionId &&
    payment.status !== 'paid'
  ) {
    try {
      await processYooKassaPaymentEvent({
        eventType: 'return.refresh',
        eventId: `return:${payment.id}:${payment.providerTransactionId}`,
        providerPaymentId: payment.providerTransactionId,
        skipWebhookDedupe: true,
      });
      payment = (await getPaymentById(paymentId)) ?? payment;
    } catch {
      // Keep last known server state if provider refresh fails.
    }
  }

  return NextResponse.json({
    paymentId: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    serviceType: payment.serviceType ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
  });
}
