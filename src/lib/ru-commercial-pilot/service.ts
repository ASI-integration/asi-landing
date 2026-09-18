import {
  applyBeginSetup,
  applyCompletePilot,
  applyDeriveReady,
  applyStartPilot,
  createApplicationState,
  type RuCommercialPilotState,
  type RuCommercialPilotTransitionResult,
} from './lifecycle';

export type RuCommercialPilotStore = {
  get(accountId: string, propertyId: string): Promise<RuCommercialPilotState | null>;
  /**
   * Persist only if the row is still in expectedStatus (compare-and-swap).
   * Returns false when another writer won the race.
   */
  compareAndSet(
    accountId: string,
    propertyId: string,
    expectedStatus: RuCommercialPilotState['status'] | null,
    next: RuCommercialPilotState,
  ): Promise<boolean>;
  upsertIfAbsent(state: RuCommercialPilotState): Promise<RuCommercialPilotState>;
};

export type ReadinessProbe = (propertyId: string) => Promise<boolean>;

export type OwnershipProbe = (accountId: string, propertyId: string) => Promise<boolean>;

export type RuCommercialPilotClock = () => Date;

export type RuCommercialPilotServiceDeps = {
  store: RuCommercialPilotStore;
  isReadinessSatisfied: ReadinessProbe;
  ownsProperty: OwnershipProbe;
  now?: RuCommercialPilotClock;
};

function requireOwned(
  owns: boolean,
): RuCommercialPilotTransitionResult | null {
  if (!owns) return { ok: false, reason: 'property_not_owned_by_account' };
  return null;
}

/**
 * Persist a domain transition with compare-and-set.
 * On CAS loss: reload and re-apply the same domain action.
 * - If re-apply is an idempotent no-op, return success with current state.
 * - If re-apply still wants to change state, return concurrent_update_retry_required
 *   (do NOT claim the original transition succeeded).
 */
async function persistTransition(
  deps: RuCommercialPilotServiceDeps,
  previous: RuCommercialPilotState | null,
  result: RuCommercialPilotTransitionResult,
  reapply: (current: RuCommercialPilotState) => RuCommercialPilotTransitionResult,
): Promise<RuCommercialPilotTransitionResult> {
  if (!result.ok) return result;
  if (!result.changed) return result;
  const expected = previous?.status ?? null;
  const saved = await deps.store.compareAndSet(
    result.state.accountId,
    result.state.propertyId,
    expected,
    result.state,
  );
  if (saved) return result;

  const current = await deps.store.get(result.state.accountId, result.state.propertyId);
  if (!current) return { ok: false, reason: 'concurrent_update_lost' };

  const again = reapply(current);
  if (!again.ok) return again;
  if (!again.changed) return again;
  return { ok: false, reason: 'concurrent_update_retry_required' };
}

export async function getPilotLifecycle(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<{ ok: true; state: RuCommercialPilotState | null } | { ok: false; reason: string }> {
  const owns = await deps.ownsProperty(accountId, propertyId);
  if (!owns) return { ok: false, reason: 'property_not_owned_by_account' };
  const state = await deps.store.get(accountId, propertyId);
  return { ok: true, state };
}

export async function ensureApplication(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<RuCommercialPilotTransitionResult> {
  const denied = requireOwned(await deps.ownsProperty(accountId, propertyId));
  if (denied) return denied;
  const existing = await deps.store.get(accountId, propertyId);
  if (existing) return { ok: true, state: existing, changed: false };
  const created = createApplicationState(accountId, propertyId);
  const state = await deps.store.upsertIfAbsent(created);
  return { ok: true, state, changed: state === created || state.status === 'application' };
}

export async function beginSetup(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<RuCommercialPilotTransitionResult> {
  const denied = requireOwned(await deps.ownsProperty(accountId, propertyId));
  if (denied) return denied;
  let current = await deps.store.get(accountId, propertyId);
  if (!current) {
    const ensured = await ensureApplication(deps, accountId, propertyId);
    if (!ensured.ok) return ensured;
    current = ensured.state;
  }
  const now = (deps.now ?? (() => new Date()))();
  const result = applyBeginSetup(current, now);
  return persistTransition(deps, current, result, (latest) => applyBeginSetup(latest, now));
}

export async function deriveReady(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<RuCommercialPilotTransitionResult> {
  const denied = requireOwned(await deps.ownsProperty(accountId, propertyId));
  if (denied) return denied;
  let current = await deps.store.get(accountId, propertyId);
  if (!current) {
    const ensured = await ensureApplication(deps, accountId, propertyId);
    if (!ensured.ok) return ensured;
    current = ensured.state;
  }
  const readiness = await deps.isReadinessSatisfied(propertyId);
  const now = (deps.now ?? (() => new Date()))();
  const result = applyDeriveReady(current, readiness, now);
  return persistTransition(deps, current, result, (latest) =>
    applyDeriveReady(latest, readiness, now),
  );
}

export async function startPilot(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<RuCommercialPilotTransitionResult> {
  const denied = requireOwned(await deps.ownsProperty(accountId, propertyId));
  if (denied) return denied;
  const current = await deps.store.get(accountId, propertyId);
  if (!current) return { ok: false, reason: 'lifecycle_not_found' };
  const readiness = await deps.isReadinessSatisfied(propertyId);
  const now = (deps.now ?? (() => new Date()))();
  const result = applyStartPilot(current, readiness, now);
  return persistTransition(deps, current, result, (latest) =>
    applyStartPilot(latest, readiness, now),
  );
}

export async function completePilot(
  deps: RuCommercialPilotServiceDeps,
  accountId: string,
  propertyId: string,
): Promise<RuCommercialPilotTransitionResult> {
  const denied = requireOwned(await deps.ownsProperty(accountId, propertyId));
  if (denied) return denied;
  const current = await deps.store.get(accountId, propertyId);
  if (!current) return { ok: false, reason: 'lifecycle_not_found' };
  const now = (deps.now ?? (() => new Date()))();
  const result = applyCompletePilot(current, now);
  return persistTransition(deps, current, result, (latest) => applyCompletePilot(latest, now));
}
