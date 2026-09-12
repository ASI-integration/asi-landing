import { replyToTelegram } from '../telegram';
import {
  claimPaymentConfirmation,
  releasePaymentConfirmation,
} from '../payments/events';

export async function sendPaymentConfirmation(params: {
  paymentId: string;
  chatId: number;
  amount: number;
  currency: string;
  serviceType?: string;
}): Promise<void> {
  const { paymentId, chatId, amount, currency, serviceType } = params;

  if (!(await claimPaymentConfirmation(paymentId))) {
    console.log(`[Notifications] Confirmation already sent for payment ${paymentId}, skipping.`);
    return;
  }

  const text = serviceType
    ? `✅ Payment received. Your request for "${serviceType}" is being processed.`
    : `✅ Payment received. Your request is being processed.`;

  try {
    const sent = await replyToTelegram(chatId, text);
    if (!sent) throw new Error('Payment confirmation delivery failed');
    console.log(`[Notifications] Sent payment confirmation to chat ${chatId} for payment ${paymentId}`);
  } catch (err) {
    await releasePaymentConfirmation(paymentId);
    console.error(`[Notifications] Failed to send payment confirmation to chat ${chatId}`, err);
    throw err;
  }
}
