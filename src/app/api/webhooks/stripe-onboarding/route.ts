/**
 * POST /api/webhooks/stripe-onboarding
 *
 * Guest Autopilot (international) card-capture webhook. Deliberately
 * separate from /api/webhooks/stripe (the existing operational_payments /
 * Telegram-pilot Checkout Session flow) — different Stripe account/key,
 * different data model, no shared state.
 *
 * Handles exactly two events:
 *   setup_intent.succeeded    → card_verified (+ auto integration_in_progress)
 *   setup_intent.setup_failed → logged only, no lifecycle change
 *
 * No other event types are subscribed to or handled. Server-side state
 * (lifecycle_status, timestamps) is authoritative and is only ever written
 * from this webhook and the ops-only integration-acceptance endpoint — never
 * from a client-submitted request body.
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getGuestAutopilotStripeClient, resolveGuestAutopilotStripeWebhookSecret } from '@/lib/billing/stripe-client';
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/payments/events';
import { markCardVerified } from '@/lib/billing/account-lifecycle';
import { supabase } from '@/lib/supabase';

const WEBHOOK_PROVIDER = 'stripe_onboarding';

export async function POST(req: Request) {
  const stripe = getGuestAutopilotStripeClient();
  const webhookSecret = resolveGuestAutopilotStripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    // Missing config = feature unavailable, not a fallback to any other Stripe/YooKassa secret.
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature') || '';
  const bodyText = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(bodyText, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-onboarding webhook] invalid signature', err);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  let claimedEventId: string | undefined;
  try {
    if (!(await claimWebhookEvent(WEBHOOK_PROVIDER, event.id))) {
      // Already processed — idempotent no-op.
      return NextResponse.json({ received: true });
    }
    claimedEventId = event.id;

    if (event.type === 'setup_intent.succeeded') {
      const setupIntent = event.data.object as Stripe.SetupIntent;
      const accountId = setupIntent.metadata?.accountId;
      const paymentMethodId =
        typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
      const customerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id;

      if (!accountId || !paymentMethodId || !customerId) {
        console.error('[stripe-onboarding webhook] setup_intent.succeeded missing accountId/payment_method/customer', {
          setupIntentId: setupIntent.id,
        });
      } else {
        await markCardVerified(accountId, {
          stripeCustomerId: customerId,
          stripePaymentMethodId: paymentMethodId,
          stripeSetupIntentId: setupIntent.id,
        });

        // Save the payment method as the customer's default for future off-session use.
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      }
    } else if (event.type === 'setup_intent.setup_failed') {
      const setupIntent = event.data.object as Stripe.SetupIntent;
      const accountId = setupIntent.metadata?.accountId;
      console.warn('[stripe-onboarding webhook] setup_intent.setup_failed', {
        accountId,
        setupIntentId: setupIntent.id,
        lastError: setupIntent.last_setup_error?.message,
      });
      if (accountId) {
        await supabase
          .from('accounts')
          .update({ stripe_setup_intent_id: setupIntent.id })
          .eq('id', accountId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    if (claimedEventId) await releaseWebhookEvent(WEBHOOK_PROVIDER, claimedEventId);
    console.error('[stripe-onboarding webhook]', err);
    return NextResponse.json({ error: 'webhook_processing_failed' }, { status: 500 });
  }
}
