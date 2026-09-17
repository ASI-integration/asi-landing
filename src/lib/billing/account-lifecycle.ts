/**
 * Persistence/orchestration layer for the Guest Autopilot (international)
 * account lifecycle. This is the only module that touches Supabase for
 * lifecycle state — all transition rules live in lifecycle.ts as pure
 * functions and are re-used here, not re-implemented.
 *
 * `accounts.lifecycle_status` is the SOLE authoritative source of truth for
 * onboarding/billing state. The legacy `accounts.subscription_status`
 * column is written here only as a derived, read-only-elsewhere
 * compatibility projection (see projectLegacySubscriptionStatus) — nothing
 * in this module ever reads it back to make a decision, and no other code
 * path is allowed to write it for an account once it has joined the new
 * lifecycle (lifecycle_status is non-null).
 *
 * lifecycle_status is NULL for every account that predates this feature or
 * was created through the RU signup path — that NULL is load-bearing, not
 * an oversight: every function below refuses to operate on a NULL-lifecycle
 * account rather than guessing a starting state for it (see requireState).
 *
 * Scope: guestautopilot.com only. Nothing here is called from any
 * asi-global.ru code path; the RU signup/account flow does not import this
 * module.
 */
import { supabase } from '@/lib/supabase';
import {
  applyCardVerified,
  applyIntegrationAccepted,
  applyIntegrationStarted,
  applyPaidActivation,
  type LifecycleState,
  type LifecycleStatus,
} from './lifecycle';
import {
  isAccountIntegrationReady,
  type IntegrationRequirement,
  type IntegrationRequirementType,
} from './integration-requirements';
import { isInternationalBillingEnabled } from './config';

type AccountLifecycleRow = {
  id: string;
  lifecycle_status: LifecycleStatus | null;
  card_verified_at: string | null;
  integration_started_at: string | null;
  integration_ready_at: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  billing_started_at: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_setup_intent_id: string | null;
  accepted_plan_id: string | null;
  billing_consent_at: string | null;
};

const ACCOUNT_LIFECYCLE_COLUMNS =
  'id, lifecycle_status, card_verified_at, integration_started_at, integration_ready_at, ' +
  'trial_started_at, trial_ends_at, billing_started_at, stripe_customer_id, ' +
  'stripe_payment_method_id, stripe_setup_intent_id, accepted_plan_id, billing_consent_at';

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Throws for a NULL-lifecycle (legacy/migrated/RU) account rather than
 * inventing a starting state. Every mutating function in this module goes
 * through this — a legacy account can never be advanced by the new
 * lifecycle machinery, only an account explicitly created with
 * lifecycle_status='signup' can.
 */
function requireState(row: AccountLifecycleRow): LifecycleState {
  if (row.lifecycle_status === null) {
    throw new Error(
      `[billing] account ${row.id} is not on the new lifecycle (lifecycle_status is NULL — ` +
        'legacy/migrated/RU account). Refusing to apply a lifecycle transition to it.',
    );
  }
  return {
    status: row.lifecycle_status,
    timestamps: {
      cardVerifiedAt: toDate(row.card_verified_at),
      integrationStartedAt: toDate(row.integration_started_at),
      integrationReadyAt: toDate(row.integration_ready_at),
      trialStartedAt: toDate(row.trial_started_at),
      trialEndsAt: toDate(row.trial_ends_at),
      billingStartedAt: toDate(row.billing_started_at),
    },
  };
}

/**
 * Legacy subscription_status is a read-only-elsewhere projection of the
 * authoritative lifecycle_status. 'trial' covers every pre-paid state
 * (matches DashboardAuthGuard's existing permissive default — nothing in
 * the old dashboard gate blocks on 'trial'); only 'paid_active' projects to
 * 'active'. There is no live path to 'paid_active' in this phase.
 */
function projectLegacySubscriptionStatus(status: LifecycleStatus): 'trial' | 'active' {
  return status === 'paid_active' ? 'active' : 'trial';
}

function stateToPatch(state: LifecycleState): Record<string, string | null> {
  return {
    lifecycle_status: state.status,
    subscription_status: projectLegacySubscriptionStatus(state.status),
    card_verified_at: state.timestamps.cardVerifiedAt?.toISOString() ?? null,
    integration_started_at: state.timestamps.integrationStartedAt?.toISOString() ?? null,
    integration_ready_at: state.timestamps.integrationReadyAt?.toISOString() ?? null,
    trial_started_at: state.timestamps.trialStartedAt?.toISOString() ?? null,
    trial_ends_at: state.timestamps.trialEndsAt?.toISOString() ?? null,
    billing_started_at: state.timestamps.billingStartedAt?.toISOString() ?? null,
  };
}

async function fetchAccountRow(accountId: string): Promise<AccountLifecycleRow> {
  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_LIFECYCLE_COLUMNS)
    .eq('id', accountId)
    .single();
  if (error) throw new Error(`[billing] failed to load account ${accountId}: ${error.message}`);
  return data as unknown as AccountLifecycleRow;
}

/** Returns null for a NULL-lifecycle (legacy/RU) account rather than throwing — read-only, safe to call from UI. */
export async function getAccountLifecycle(accountId: string): Promise<LifecycleState | null> {
  const row = await fetchAccountRow(accountId);
  if (row.lifecycle_status === null) return null;
  return requireState(row);
}

/**
 * Card attach step. Called from the SetupIntent-succeeded webhook only —
 * never from a client-submitted request, and never from client-side
 * confirmation success alone — since server-side state must be
 * authoritative. Immediately also starts integration_in_progress: per the
 * approved lifecycle there is no separate customer action between the two,
 * and integration may never begin without a verified card first (enforced
 * structurally: applyIntegrationStarted only accepts a 'card_verified'
 * input state).
 *
 * Idempotent and non-destructive on replay: once card_verified_at is set,
 * a duplicate/retried webhook delivery does not overwrite it, and does not
 * overwrite the stored Stripe references either — swapping the saved
 * payment method is a future explicit card-replacement operation, not a
 * side effect of replaying this event.
 */
export async function markCardVerified(
  accountId: string,
  stripeRefs: { stripeCustomerId: string; stripePaymentMethodId: string; stripeSetupIntentId: string },
  now: Date = new Date(),
): Promise<LifecycleState> {
  const row = await fetchAccountRow(accountId);
  const current = requireState(row);

  const verified = applyCardVerified(current, now);
  if (!verified.ok) throw new Error(`[billing] ${verified.reason}`);

  if (!verified.changed) {
    // Already card_verified (or further along) — idempotent no-op. Do not
    // touch stripe_* references; that would silently swap the saved card.
    return verified.state;
  }

  const started = applyIntegrationStarted(verified.state, now);
  if (!started.ok) throw new Error(`[billing] ${started.reason}`);

  const patch: Record<string, string | null> = {
    ...stateToPatch(started.state),
    stripe_customer_id: stripeRefs.stripeCustomerId,
    stripe_payment_method_id: stripeRefs.stripePaymentMethodId,
    stripe_setup_intent_id: stripeRefs.stripeSetupIntentId,
  };

  const { error } = await supabase.from('accounts').update(patch).eq('id', accountId);
  if (error) throw new Error(`[billing] failed to persist card_verified for ${accountId}: ${error.message}`);

  return started.state;
}

async function fetchRequirements(accountId: string): Promise<IntegrationRequirement[]> {
  const { data, error } = await supabase
    .from('integration_requirements')
    .select('*')
    .eq('account_id', accountId);
  if (error) throw new Error(`[billing] failed to load integration requirements for ${accountId}: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    accountId: r.account_id,
    type: r.type,
    label: r.label,
    required: r.required,
    status: r.status,
    connectedAt: r.connected_at,
    verifiedAt: r.verified_at,
    failureReason: r.failure_reason,
    acceptanceEvidence: r.acceptance_evidence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Ops-triggered definition of a required integration for an account. Safe to
 * call repeatedly (upsert on the account_id+type unique constraint) — does
 * not reset an already-accepted requirement's status/evidence.
 */
export async function defineIntegrationRequirement(
  accountId: string,
  type: IntegrationRequirementType,
  label: string,
  required = true,
): Promise<void> {
  const { data: existing } = await supabase
    .from('integration_requirements')
    .select('id')
    .eq('account_id', accountId)
    .eq('type', type)
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from('integration_requirements').insert({
    account_id: accountId,
    type,
    label,
    required,
    status: 'pending',
  });
  if (error) throw new Error(`[billing] failed to define requirement ${type} for ${accountId}: ${error.message}`);
}

/**
 * Ops-triggered acceptance of one integration requirement. Acceptance is
 * always explicit (never auto-inferred from "some data arrived", and never
 * inferred from mere technical connectivity — the requirement's own status
 * distinguishes 'connected' from 'accepted') — the caller (an authenticated
 * internal endpoint) supplies acceptanceEvidence. Fails closed if the
 * requirement was never defined, and fails closed if the account has not
 * reached card_verified/integration_in_progress yet (an account still at
 * 'signup' cannot have an integration accepted — card comes first).
 *
 * If this is the last required requirement to reach `accepted`, this same
 * call fires the IntegrationAccepted domain event atomically:
 * integration_ready_at is set AND the account moves straight to
 * trial_active with the 14-day trial window in the same operation — the
 * account does not sit in a persisted 'integration_ready' resting state.
 * Repeating this call for an already-accepted requirement (or after the
 * account is already trial_active/paid_active) is a no-op — it does not
 * reset integration_ready_at, trial_started_at, or trial_ends_at.
 */
export async function acceptIntegrationRequirement(
  accountId: string,
  type: IntegrationRequirementType,
  evidence: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ state: LifecycleState; integrationReady: boolean }> {
  const { data: updated, error: upsertError } = await supabase
    .from('integration_requirements')
    .update({
      status: 'accepted',
      verified_at: now.toISOString(),
      acceptance_evidence: evidence,
      updated_at: now.toISOString(),
    })
    .eq('account_id', accountId)
    .eq('type', type)
    .select('id');
  if (upsertError) {
    throw new Error(`[billing] failed to accept requirement ${type} for ${accountId}: ${upsertError.message}`);
  }
  if (!updated || updated.length === 0) {
    throw new Error(`[billing] requirement ${type} was never defined for account ${accountId}`);
  }

  const requirements = await fetchRequirements(accountId);
  const ready = isAccountIntegrationReady(requirements);

  const row = await fetchAccountRow(accountId);
  const current = requireState(row);

  if (!ready) {
    return { state: current, integrationReady: false };
  }

  const accepted = applyIntegrationAccepted(current, now);
  if (!accepted.ok) throw new Error(`[billing] ${accepted.reason}`);

  if (accepted.changed) {
    const { error } = await supabase.from('accounts').update(stateToPatch(accepted.state)).eq('id', accountId);
    if (error) throw new Error(`[billing] failed to persist integration_ready for ${accountId}: ${error.message}`);
  }

  return { state: accepted.state, integrationReady: true };
}

export type PaidActivationRequest = {
  acceptedPlanId: string;
  billingConsentAt: Date;
};

/**
 * paid_active transition — the policy boundary equivalent to
 * `canActivatePaidBilling`. Re-validates every condition server-side —
 * nothing here trusts a client-submitted lifecycle state. Under the current
 * configuration (INTERNATIONAL_BILLING_ENABLED unset/false), this always
 * rejects with "billing feature is disabled", regardless of how far the
 * account has otherwise progressed — that is the intended fail-closed
 * behavior for this phase.
 *
 * Deliberately does not call any Stripe subscription/charge API. Creating
 * the real Stripe subscription once merchant/pricing/legal terms are
 * approved is future work, not implemented here.
 */
export async function requestPaidActivation(
  accountId: string,
  request: PaidActivationRequest,
  now: Date = new Date(),
): Promise<LifecycleState> {
  const row = await fetchAccountRow(accountId);
  const current = requireState(row);

  const result = applyPaidActivation(current, {
    now,
    hasVerifiedPaymentMethod: Boolean(row.stripe_payment_method_id),
    hasAcceptedPlan: Boolean(request.acceptedPlanId),
    hasBillingConsent: Boolean(request.billingConsentAt),
    billingFeatureEnabled: isInternationalBillingEnabled(),
  });

  if (!result.ok) {
    throw new Error(`[billing] paid activation rejected for ${accountId}: ${result.reason}`);
  }

  if (result.changed) {
    const patch = {
      ...stateToPatch(result.state),
      accepted_plan_id: request.acceptedPlanId,
      billing_consent_at: request.billingConsentAt.toISOString(),
    };
    const { error } = await supabase.from('accounts').update(patch).eq('id', accountId);
    if (error) throw new Error(`[billing] failed to persist paid_active for ${accountId}: ${error.message}`);
  }

  return result.state;
}
