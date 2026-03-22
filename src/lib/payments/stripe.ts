import Stripe from 'stripe';
import { PaymentProvider, PaymentRequest, PaymentStatus } from './types';

// Real usage requires a configured webhook secret in env
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || 'sk_test_fake';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_fake';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const stripeClient = new Stripe(STRIPE_SECRET, { apiVersion: '2024-10-28.acacia' });

export class StripeProvider implements PaymentProvider {
  async createPaymentLink(params: Omit<PaymentRequest, "id" | "provider" | "providerTransactionId" | "status" | "createdAt" | "updatedAt" | "checkoutUrl">): Promise<{ checkoutUrl: string; transactionId: string; }> {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency,
            product_data: {
              name: params.metadata.serviceType || 'ASI Service',
              description: `Reservation: ${params.metadata.reservationId || 'N/A'}, Property: ${params.metadata.propertyId || 'N/A'}`,
            },
            unit_amount: Math.round(params.amount * 100), // Stripe expects cents natively, assuming 'amount' is float if USD, so cent-adjust
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${APP_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/payments/cancel`,
      metadata: { ...params.metadata, chatId: params.metadata.chatId?.toString() || '' },
    });

    return {
      checkoutUrl: session.url!,
      transactionId: session.id,
    };
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    try {
      stripeClient.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
      return true;
    } catch (err) {
      return false;
    }
  }

  async parseWebhookEvent(payload: string | Buffer, signature: string): Promise<{ transactionId: string; status: PaymentStatus; rawEvent: any; }> {
    const event = stripeClient.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
    let status: PaymentStatus = 'pending';

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        status = 'paid';
      }
      return { transactionId: session.id, status, rawEvent: event };
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      status = 'failed';
      return { transactionId: session.id, status, rawEvent: event };
    }

    return { transactionId: (event.data.object as any).id, status: 'pending', rawEvent: event };
  }
}
