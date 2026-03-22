import Stripe from 'stripe';
import { PaymentProvider, PaymentRequest, PaymentStatus } from './types';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || 'sk_test_fake';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const stripeClient = new Stripe(STRIPE_SECRET);

export class StripeProvider implements PaymentProvider {
  async createPaymentLink(
    params: Omit<PaymentRequest, 'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'paymentUrl'>
  ): Promise<{ paymentUrl: string; transactionId: string }> {
    const description = [
      params.description,
      params.reservationId ? `Reservation: ${params.reservationId}` : null,
      params.propertyId ? `Property: ${params.propertyId}` : null,
    ]
      .filter(Boolean)
      .join(' | ') || undefined;

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: params.serviceType || 'ASI Service',
              ...(description ? { description } : {}),
            },
            unit_amount: Math.round(params.amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${APP_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/payments/cancel`,
      metadata: {
        paymentRequestId: params.id,
        reservationId: params.reservationId || '',
        propertyId: params.propertyId || '',
        guestId: params.guestId || '',
        chatId: params.chatId || '',
        serviceType: params.serviceType || '',
      },
    });

    return {
      paymentUrl: session.url!,
      transactionId: session.id,
    };
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    try {
      stripeClient.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
      return true;
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(
    payload: string | Buffer,
    signature: string
  ): Promise<{ transactionId: string; status: PaymentStatus; eventId?: string; rawEvent: unknown }> {
    const event = stripeClient.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const status: PaymentStatus =
        session.payment_status === 'paid' ? 'paid' : 'requires_action';
      return { transactionId: session.id, status, eventId: event.id, rawEvent: event };
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      return { transactionId: session.id, status: 'expired', eventId: event.id, rawEvent: event };
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return { transactionId: session.id, status: 'failed', eventId: event.id, rawEvent: event };
    }

    return {
      transactionId: (event.data.object as { id: string }).id,
      status: 'pending',
      eventId: event.id,
      rawEvent: event,
    };
  }
}
