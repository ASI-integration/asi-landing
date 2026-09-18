/**
 * RU commercial pilot lifecycle — pure domain machine (P0-01).
 *
 * Canonical commercial SSOT for asi-global.ru:
 *   application → setup → ready → pilot_active → pilot_completed
 *   → report_ready → continued | stopped
 *
 * Hard invariant: pilot_active requires readiness satisfied at start time.
 * Guest Autopilot Stripe TRIAL_DAYS is a different product — do not reuse it.
 */

export const RU_COMMERCIAL_PILOT_STATUSES = [
  'application',
  'setup',
  'ready',
  'pilot_active',
  'pilot_completed',
  'report_ready',
  'continued',
  'stopped',
] as const;

export type RuCommercialPilotStatus = (typeof RU_COMMERCIAL_PILOT_STATUSES)[number];

/** Free operational pilot length sold on RU site (calendar days, UTC). */
export const RU_COMMERCIAL_PILOT_DAYS = 14;

/** Explicit allow-list. Anything not listed is rejected. */
export const RU_COMMERCIAL_PILOT_ALLOWED_TRANSITIONS: Record<
  RuCommercialPilotStatus,
  RuCommercialPilotStatus[]
> = {
  application: ['setup'],
  setup: ['ready'],
  ready: ['pilot_active'],
  pilot_active: ['pilot_completed'],
  pilot_completed: ['report_ready'],
  report_ready: ['continued', 'stopped'],
  continued: [],
  stopped: [],
};

export type RuCommercialPilotTimestamps = {
  setupStartedAt: Date | null;
  readyAt: Date | null;
  pilotStartedAt: Date | null;
  pilotEndsAt: Date | null;
  pilotCompletedAt: Date | null;
  reportReadyAt: Date | null;
  continuationDecidedAt: Date | null;
};

export type RuCommercialPilotState = {
  accountId: string;
  propertyId: string;
  status: RuCommercialPilotStatus;
  timestamps: RuCommercialPilotTimestamps;
};

export type RuCommercialPilotTransitionResult =
  | { ok: true; state: RuCommercialPilotState; changed: boolean }
  | { ok: false; reason: string };

export function canTransition(
  from: RuCommercialPilotStatus,
  to: RuCommercialPilotStatus,
): boolean {
  return RU_COMMERCIAL_PILOT_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function derivePilotWindow(pilotStartedAt: Date): {
  pilotStartedAt: Date;
  pilotEndsAt: Date;
} {
  return {
    pilotStartedAt,
    pilotEndsAt: addUtcDays(pilotStartedAt, RU_COMMERCIAL_PILOT_DAYS),
  };
}

export function emptyTimestamps(): RuCommercialPilotTimestamps {
  return {
    setupStartedAt: null,
    readyAt: null,
    pilotStartedAt: null,
    pilotEndsAt: null,
    pilotCompletedAt: null,
    reportReadyAt: null,
    continuationDecidedAt: null,
  };
}

export function createApplicationState(
  accountId: string,
  propertyId: string,
): RuCommercialPilotState {
  return {
    accountId,
    propertyId,
    status: 'application',
    timestamps: emptyTimestamps(),
  };
}

export function applyBeginSetup(
  state: RuCommercialPilotState,
  now: Date,
): RuCommercialPilotTransitionResult {
  if (state.status === 'setup') {
    return { ok: true, state, changed: false };
  }
  if (state.status !== 'application') {
    if (
      RU_COMMERCIAL_PILOT_STATUSES.indexOf(state.status) >
      RU_COMMERCIAL_PILOT_STATUSES.indexOf('setup')
    ) {
      return { ok: true, state, changed: false };
    }
    return { ok: false, reason: `cannot begin setup from status "${state.status}"` };
  }
  return {
    ok: true,
    changed: true,
    state: {
      ...state,
      status: 'setup',
      timestamps: {
        ...state.timestamps,
        setupStartedAt: state.timestamps.setupStartedAt ?? now,
      },
    },
  };
}

/**
 * setup → ready only when external readiness evidence is satisfied.
 * Does not start the 14-day pilot clock.
 */
export function applyDeriveReady(
  state: RuCommercialPilotState,
  readinessSatisfied: boolean,
  now: Date,
): RuCommercialPilotTransitionResult {
  if (state.status === 'ready') {
    return { ok: true, state, changed: false };
  }
  if (
    RU_COMMERCIAL_PILOT_STATUSES.indexOf(state.status) >
    RU_COMMERCIAL_PILOT_STATUSES.indexOf('ready')
  ) {
    return { ok: true, state, changed: false };
  }
  if (state.status !== 'setup' && state.status !== 'application') {
    return { ok: false, reason: `cannot derive ready from status "${state.status}"` };
  }
  if (!readinessSatisfied) {
    return { ok: false, reason: 'readiness_not_satisfied' };
  }
  const withSetup =
    state.status === 'application'
      ? applyBeginSetup(state, now)
      : ({ ok: true as const, changed: false, state });
  if (!withSetup.ok) return withSetup;
  const base = withSetup.state;
  return {
    ok: true,
    changed: true,
    state: {
      ...base,
      status: 'ready',
      timestamps: {
        ...base.timestamps,
        setupStartedAt: base.timestamps.setupStartedAt ?? now,
        readyAt: now,
      },
    },
  };
}

/**
 * ready → pilot_active. Requires readiness still true.
 * Idempotent: already active returns original timestamps unchanged.
 */
export function applyStartPilot(
  state: RuCommercialPilotState,
  readinessSatisfied: boolean,
  now: Date,
): RuCommercialPilotTransitionResult {
  if (state.status === 'pilot_active') {
    return { ok: true, state, changed: false };
  }
  if (state.status === 'pilot_completed' || state.status === 'report_ready' || state.status === 'continued' || state.status === 'stopped') {
    return { ok: false, reason: `cannot restart pilot from status "${state.status}"` };
  }
  if (state.status === 'application' || state.status === 'setup') {
    return { ok: false, reason: 'cannot_start_pilot_before_ready' };
  }
  if (state.status !== 'ready') {
    return { ok: false, reason: `cannot start pilot from status "${state.status}"` };
  }
  if (!readinessSatisfied) {
    return { ok: false, reason: 'readiness_not_satisfied' };
  }
  const window = derivePilotWindow(now);
  return {
    ok: true,
    changed: true,
    state: {
      ...state,
      status: 'pilot_active',
      timestamps: {
        ...state.timestamps,
        pilotStartedAt: window.pilotStartedAt,
        pilotEndsAt: window.pilotEndsAt,
      },
    },
  };
}

/**
 * pilot_active → pilot_completed when now >= pilot_ends_at.
 * Never charges, never enables payment, never moves to continued.
 */
export function applyCompletePilot(
  state: RuCommercialPilotState,
  now: Date,
): RuCommercialPilotTransitionResult {
  if (state.status === 'pilot_completed') {
    return { ok: true, state, changed: false };
  }
  if (
    state.status === 'report_ready' ||
    state.status === 'continued' ||
    state.status === 'stopped'
  ) {
    return { ok: true, state, changed: false };
  }
  if (state.status !== 'pilot_active') {
    return { ok: false, reason: `cannot complete pilot from status "${state.status}"` };
  }
  const endsAt = state.timestamps.pilotEndsAt;
  if (!endsAt) {
    return { ok: false, reason: 'pilot_ends_at_missing' };
  }
  if (now.getTime() < endsAt.getTime()) {
    return { ok: false, reason: 'pilot_not_yet_ended' };
  }
  return {
    ok: true,
    changed: true,
    state: {
      ...state,
      status: 'pilot_completed',
      timestamps: {
        ...state.timestamps,
        pilotCompletedAt: now,
      },
    },
  };
}
