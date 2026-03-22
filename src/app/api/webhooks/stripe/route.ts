import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';

export async function POST(req: Request) {
  try {
    const provider = getProvider('stripe');
    const signature = req.headers.get('stripe-signature') || '';
    
    // We need raw string for stripe signature verification
    const bodyText = await req.text();

    if (!provider.verifyWebhookSignature(bodyText, signature)) {
      console.error('[Stripe Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const { transactionId, status } = await provider.parseWebhookEvent(bodyText, signature);
    const payment = await getPaymentByTransactionId(transactionId);
    
    if (!payment) {
      console.warn(`[Stripe Webhook] Unrecognized transaction ID ${transactionId}`);
      return NextResponse.json({ received: true }); 
    }

    // Idempotent string safety
    const updated = await updatePaymentStatus(transactionId, status);
    
    if (updated && status === 'paid' && payment.metadata?.chatId) {
      // Send bot confirmation seamlessly
      await sendPaymentConfirmation({
        chatId: payment.metadata.chatId,
        amount: payment.amount,
        currency: payment.currency,
        serviceType: payment.metadata.serviceType
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
