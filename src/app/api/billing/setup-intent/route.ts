/**
 * POST /api/billing/setup-intent
 *
 * Guest Autopilot (international) card-capture step. Creates (or reuses) a
 * Stripe customer for the caller's account and returns a SetupIntent client
 * secret for the browser to confirm with Stripe.js/Elements.
 *
 * No charge is created here or anywhere in this flow. This is a
 * `setup_intent`, not a PaymentIntent — see src/lib/billing/stripe-client.ts
 * for why this can only ever run against a Stripe *test* key.
 *
 * RU-host requests are rejected outright: this endpoint is guestautopilot.com
 * only and must never be reachable from asi-global.ru.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { getGuestAutopilotStripeClient, isGuestAutopilotStripeConfigured } from '@/lib/billing/stripe-client';

export const runtime = 'nodejs';

export async function POST() {
  const isRuHost = await getIsRuHost();
  if (isRuHost) {
    return NextResponse.json({ error: 'not_available_on_this_host' }, { status: 404 });
  }

  if (!isGuestAutopilotStripeConfigured()) {
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId || accountId === 'legacy') {
    return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
  }

  const stripe = getGuestAutopilotStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 });
  }

  try {
    const { data: account, error } = await supabase
      .from('accounts')
      .select('id, stripe_customer_id')
      .eq('id', accountId)
      .single();
    if (error) throw error;

    let stripeCustomerId: string | null = account?.stripe_customer_id ?? null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: session.email,
        metadata: { accountId },
      });
      stripeCustomerId = customer.id;
      const { error: updateErr } = await supabase
        .from('accounts')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', accountId);
      if (updateErr) throw updateErr;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { accountId },
    });

    await supabase
      .from('accounts')
      .update({ stripe_setup_intent_id: setupIntent.id })
      .eq('id', accountId);

    return NextResponse.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error('[billing/setup-intent]', err);
    return NextResponse.json({ error: 'setup_intent_failed' }, { status: 500 });
  }
}
