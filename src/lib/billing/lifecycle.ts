/**
 * Guest Autopilot (international) account lifecycle — pure state machine.
 *
 * Canonical lifecycle:
 *   signup → card_verified → integration_in_progress → integration_ready
 *          → trial_active → paid_active
 *
 * Hard invariant: trial_started_at is derived from integration_ready_at,
 * never from signup_at or card_verified_at. Attaching a card never starts
 * the trial; starting integration never starts the trial.
 *
 * This module has no I/O — no Supabase, no Stripe, no network. It exists so
 * every transition rule can be unit-tested as a pure function. The
 * persistence layer (account-lifecycle.ts) is the only caller.
 */

export const LIFECYCLE_STATUSES = [
  'signup',
  'card_verified',
  'integration_in_progress',
  'integration_ready',
  'trial_active',
  'paid_active',
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const TRIAL_DAYS = 14;

/** Explicit allow-list. Anything not listed here is a rejected transition. */
const ALLOWED_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  signup: ['card_verified'],
  card_verified: ['integration_in_progress'],
  integration_in_progress: ['integration_ready'],
  integration_ready: ['trial_active'],
  trial_active: ['paid_active'],
  paid_active: [],
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type LifecycleTimestamps = {
  cardVerifiedAt: Date | null;
  integrationStartedAt: Date | null;
  integrationReadyAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  billingStartedAt: Date | null;
};

export type LifecycleState = {
  status: LifecycleStatus;
  timestamps: LifecycleTimestamps;
};

export type TransitionResult =
  | { ok: true; state: LifecycleState; changed: boolean }
  | { ok: false; reason: string };

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** trial_ends_at = integration_ready_at + 14 calendar days, always derived, never stored independently of this rule. */
export function deriveTrialWindow(integrationReadyAt: Date): { trialStartedAt: Date; trialEndsAt: Date } {
  return { trialStartedAt: integrationReadyAt, trialEndsAt: addDays(integrationReadyAt, TRIAL_DAYS) };
}

/**
 * card_verified: SetupIntent succeeded. No charge. Idempotent — calling this
 * again once already past `card_verified` does not rewind or duplicate state.
 */
export function applyCardVerified(state: LifecycleState, now: Date): TransitionResult {
  if (state.status !== 'signup') {
    // Already verified (or further along) — idempotent no-op, not an error.
    if (state.status === 'card_verified' || LIFECYCLE_STATUSES.indexOf(state.status) > LIFECYCLE_STATUSES.indexOf('card_verified')) {
      return { ok: true, state, changed: false };
    }
    return { ok: false, reason: `cannot mark card_verified from status "${state.status}"` };
  }
  return {
    ok: true,
    changed: true,
    state: {
      status: 'card_verified',
      timestamps: { ...state.timestamps, cardVerifiedAt: now },
    },
  };
}

/**
 * integration_in_progress: automatic the moment the card is verified — ASI
 * begins connecting to the customer's systems. Not a separate customer
 * action; called immediately after applyCardVerified by the orchestration
 * layer. Idempotent.
 */
export function applyIntegrationStarted(state: LifecycleState, now: Date): TransitionResult {
  if (state.status !== 'card_verified') {
    if (LIFECYCLE_STATUSES.indexOf(state.status) > LIFECYCLE_STATUSES.indexOf('integration_in_progress')) {
      return { ok: true, state, changed: false };
    }
    if (state.status === 'integration_in_progress') {
      return { ok: true, state, changed: false };
    }
    return { ok: false, reason: `cannot start integration from status "${state.status}"` };
  }
  return {
    ok: true,
    changed: true,
    state: {
      status: 'integration_in_progress',
      timestamps: { ...state.timestamps, integrationStartedAt: now },
    },
  };
}

/**
 * IntegrationAccepted domain event: all required integration requirements
 * for the account reached `accepted`. This single transition sets
 * integration_ready_at AND immediately activates the trial in the same
 * operation — per the approved lifecycle, trial_active follows
 * integration_ready with no separate manual step.
 *
 * Idempotent: repeating this call once already integration_ready or later
 * does NOT reset trial_started_at/trial_ends_at.
 */
export function applyIntegrationAccepted(state: LifecycleState, now: Date): TransitionResult {
  if (state.status === 'integration_in_progress') {
    const { trialStartedAt, trialEndsAt } = deriveTrialWindow(now);
    return {
      ok: true,
      changed: true,
      state: {
        status: 'trial_active',
        timestamps: {
          ...state.timestamps,
          integrationReadyAt: now,
          trialStartedAt,
          trialEndsAt,
        },
      },
    };
  }
  if (LIFECYCLE_STATUSES.indexOf(state.status) >= LIFECYCLE_STATUSES.indexOf('integration_ready')) {
    // Already accepted (possibly a duplicate webhook/callback) — do not move the trial window.
    return { ok: true, state, changed: false };
  }
  return { ok: false, reason: `cannot accept integration from status "${state.status}"` };
}

export type PaidActivationGateInput = {
  now: Date;
  hasVerifiedPaymentMethod: boolean;
  hasAcceptedPlan: boolean;
  hasBillingConsent: boolean;
  billingFeatureEnabled: boolean;
};

export type PaidActivationGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Hard safety gate for paid_active. Every condition is required; the first
 * failing one is reported. This function does not mutate state or call
 * Stripe — it only answers "is activation currently allowed."
 */
export function evaluatePaidActivationGate(
  state: LifecycleState,
  input: PaidActivationGateInput,
): PaidActivationGateResult {
  if (state.status !== 'trial_active') {
    return { allowed: false, reason: `lifecycle status "${state.status}" is not trial_active` };
  }
  if (!state.timestamps.integrationReadyAt) {
    return { allowed: false, reason: 'integration_ready_at is missing' };
  }
  if (!state.timestamps.trialEndsAt) {
    return { allowed: false, reason: 'trial_ends_at is missing' };
  }
  if (input.now.getTime() < state.timestamps.trialEndsAt.getTime()) {
    return { allowed: false, reason: 'trial has not ended yet' };
  }
  if (!input.hasVerifiedPaymentMethod) {
    return { allowed: false, reason: 'no verified payment method on file' };
  }
  if (!input.hasAcceptedPlan) {
    return { allowed: false, reason: 'no accepted plan' };
  }
  if (!input.hasBillingConsent) {
    return { allowed: false, reason: 'no billing consent on record' };
  }
  if (!input.billingFeatureEnabled) {
    return { allowed: false, reason: 'billing feature is disabled' };
  }
  return { allowed: true };
}

/**
 * paid_active transition. Only reachable when evaluatePaidActivationGate
 * allows it — this function re-checks the gate itself so it can never be
 * called out-of-band into an invalid state.
 */
export function applyPaidActivation(
  state: LifecycleState,
  input: PaidActivationGateInput,
): TransitionResult {
  if (state.status === 'paid_active') {
    return { ok: true, state, changed: false };
  }
  const gate = evaluatePaidActivationGate(state, input);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason };
  }
  return {
    ok: true,
    changed: true,
    state: {
      status: 'paid_active',
      timestamps: { ...state.timestamps, billingStartedAt: input.now },
    },
  };
}
