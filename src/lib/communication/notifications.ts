import { replyToTelegram } from '../telegram';

export async function sendPaymentConfirmation(params: {
  chatId: number;
  amount: number;
  currency: string;
  serviceType?: string;
}) {
  const { chatId, amount, currency, serviceType } = params;
  
  const text = `✅ Payment confirmed! We received your payment for ${amount} ${currency}${serviceType ? ` (${serviceType})` : ''}. Thank you!`;
  
  try {
    await replyToTelegram(chatId, text);
    console.log(`[Notifications] Sent payment confirmation to ${chatId}`);
  } catch (err) {
    console.error(`[Notifications] Failed to send payment confirmation to ${chatId}`, err);
  }
}
