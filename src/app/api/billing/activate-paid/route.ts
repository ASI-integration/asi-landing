/**
 * POST /api/billing/activate-paid
 *
 * Billing boundary for the future paid_active transition. Under the current
 * configuration (INTERNATIONAL_BILLING_ENABLED unset/false), this endpoint
 * always rejects — see lib/billing/lifecycle.ts#evaluatePaidActivationGate.
 * It does not call any Stripe subscription/charge API; creating the real
 * subscription once merchant/pricing/legal terms are approved is future
 * work, not implemented here.
 *
 * RU-host requests are rejected outright: guestautopilot.com only.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { requestPaidActivation } from '@/lib/billing/account-lifecycle';
import { readRequestJson } from '@/lib/safeRequestJson';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const isRuHost = await getIsRuHost();
  if (isRuHost) {
    return NextResponse.json({ error: 'not_available_on_this_host' }, { status: 404 });
  }

  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const parsed = await readRequestJson<{ acceptedPlanId?: string }>(req);
  if (!parsed.ok || !parsed.data.acceptedPlanId) {
    return NextResponse.json({ error: 'acceptedPlanId is required' }, { status: 400 });
  }

  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId || accountId === 'legacy') {
    return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
  }

  try {
    const state = await requestPaidActivation(accountId, {
      acceptedPlanId: parsed.data.acceptedPlanId,
      billingConsentAt: new Date(),
    });
    return NextResponse.json({ ok: true, lifecycleStatus: state.status });
  } catch (err) {
    // Expected/normal today: billing is disabled, so this always rejects.
    const message = err instanceof Error ? err.message : 'activation_rejected';
    return NextResponse.json({ error: 'activation_rejected', message }, { status: 403 });
  }
}
