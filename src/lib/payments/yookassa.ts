import { PaymentProvider, PaymentRequest, PaymentStatus } from './types';

const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET_KEY || 'test_secret';
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || 'test_shop';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export class YookassaProvider implements PaymentProvider {
  async createPaymentLink(
    params: Omit<PaymentRequest, 'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'paymentUrl'>
  ): Promise<{ paymentUrl: string; transactionId: string }> {
    const amountStr = params.amount.toFixed(2);
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET}`).toString('base64');
    // Use internal payment ID as idempotency key so retries are safe
    const idempotencyKey = params.id;

    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': idempotencyKey,
      },
      body: JSON.stringify({
        amount: { value: amountStr, currency: params.currency || 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: `${APP_URL}/payments/success?provider=yookassa`,
        },
        capture: true,
        description: params.description || params.serviceType || 'ASI Payment',
        metadata: {
          paymentRequestId: params.id,
          reservationId: params.reservationId || '',
          propertyId: params.propertyId || '',
          guestId: params.guestId || '',
          chatId: params.chatId || '',
          serviceType: params.serviceType || '',
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`YooKassa API Error: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      paymentUrl: data.confirmation.confirmation_url,
      transactionId: data.id,
    };
  }

  verifyWebhookSignature(_payload: string | Buffer, _signature: string): boolean {
    // YooKassa uses IP whitelisting rather than HMAC signatures.
    // In production: verify the request originates from YooKassa's IP ranges.
    return true;
  }

  async parseWebhookEvent(
    payload: string | Buffer,
    _signature: string
  ): Promise<{ transactionId: string; status: PaymentStatus; eventId?: string; rawEvent: unknown }> {
    const bodyStr = typeof payload === 'string' ? payload : payload.toString('utf8');
    const event = JSON.parse(bodyStr);

    let status: PaymentStatus = 'pending';
    if (event.event === 'payment.succeeded') {
      status = 'paid';
    } else if (event.event === 'payment.canceled') {
      status = 'cancelled';
    }

    const transactionId: string = event.object.id;
    // YooKassa event objects use the payment ID as their unique identifier
    return { transactionId, status, eventId: transactionId, rawEvent: event };
  }
}
