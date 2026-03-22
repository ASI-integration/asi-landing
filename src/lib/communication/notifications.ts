import { replyToTelegram } from '../telegram';
import { hasConfirmationBeenSent, markConfirmationSent } from '../payments/events';

export async function sendPaymentConfirmation(params: {
  paymentId: string;
  chatId: number;
  amount: number;
  currency: string;
  serviceType?: string;
}): Promise<void> {
  const { paymentId, chatId, amount, currency, serviceType } = params;

  if (hasConfirmationBeenSent(paymentId)) {
    console.log(`[Notifications] Confirmation already sent for payment ${paymentId}, skipping.`);
    return;
  }

  const text = serviceType
    ? `✅ Payment received. Your request for "${serviceType}" is being processed.`
    : `✅ Payment received. Your request is being processed.`;

  try {
    await replyToTelegram(chatId, text);
    markConfirmationSent(paymentId);
    console.log(`[Notifications] Sent payment confirmation to chat ${chatId} for payment ${paymentId}`);
  } catch (err) {
    console.error(`[Notifications] Failed to send payment confirmation to chat ${chatId}`, err);
  }
}
