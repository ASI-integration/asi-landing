import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/payments/factory';
import { updatePaymentStatus, getPaymentByTransactionId } from '@/lib/payments/db';
import { sendPaymentConfirmation } from '@/lib/communication/notifications';

export async function POST(req: Request) {
  try {
    const provider = getProvider('yookassa');
    const signature = ''; // Yookassa typically relies on mTLS or IP whitelists
    
    const bodyText = await req.text();

    if (!provider.verifyWebhookSignature(bodyText, signature)) {
      console.error('[Yookassa Webhook] Invalid signature logic');
      return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
    }

    const { transactionId, status } = await provider.parseWebhookEvent(bodyText, signature);
    const payment = await getPaymentByTransactionId(transactionId);
    
    if (!payment) {
      console.warn(`[Yookassa Webhook] Unrecognized transaction ID ${transactionId}`);
      return NextResponse.json({ received: true }); 
    }

    // Idempotent update
    const updated = await updatePaymentStatus(transactionId, status);
    
    if (updated && status === 'paid' && payment.metadata?.chatId) {
      // Send bot confirmation smoothly 
      await sendPaymentConfirmation({
        chatId: payment.metadata.chatId,
        amount: payment.amount,
        currency: payment.currency,
        serviceType: payment.metadata.serviceType
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Yookassa Webhook Error]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
