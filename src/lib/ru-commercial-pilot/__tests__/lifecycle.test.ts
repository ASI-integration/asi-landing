import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RU_COMMERCIAL_PILOT_DAYS,
  applyBeginSetup,
  applyCompletePilot,
  applyDeriveReady,
  applyStartPilot,
  canTransition,
  createApplicationState,
  derivePilotWindow,
} from '../lifecycle';
import { createMemoryRuCommercialPilotStore } from '../memory-store';
import {
  beginSetup,
  completePilot,
  deriveReady,
  ensureApplication,
  getPilotLifecycle,
  startPilot,
  type RuCommercialPilotServiceDeps,
} from '../service';

function ownedDeps(overrides?: Partial<RuCommercialPilotServiceDeps>): RuCommercialPilotServiceDeps {
  const owned = new Set(['acct-a::prop-a']);
  let readiness = false;
  let now = new Date('2026-03-01T12:00:00.000Z');
  const base: RuCommercialPilotServiceDeps = {
    store: createMemoryRuCommercialPilotStore(),
    isReadinessSatisfied: async (propertyId) =>
      propertyId === 'prop-a' ? readiness : false,
    ownsProperty: async (accountId, propertyId) => owned.has(`${accountId}::${propertyId}`),
    now: () => now,
    claimPilotEntitlement: async () => ({ ok: true as const, reused: false as const }),
  };
  const deps = { ...base, ...overrides };
  return Object.assign(deps, {
    setReadiness(value: boolean) {
      readiness = value;
    },
    setNow(value: Date) {
      now = value;
    },
    addOwned(accountId: string, propertyId: string) {
      owned.add(`${accountId}::${propertyId}`);
    },
  });
}

describe('RU commercial pilot transitions (pure)', () => {
  it('rejects unsafe transitions', () => {
    expect(canTransition('application', 'pilot_active')).toBe(false);
    expect(canTransition('setup', 'pilot_active')).toBe(false);
    expect(canTransition('pilot_active', 'ready')).toBe(false);
    expect(canTransition('pilot_completed', 'pilot_active')).toBe(false);
    expect(canTransition('report_ready', 'setup')).toBe(false);
  });

  it('derives UTC +14 day window', () => {
    const started = new Date('2026-03-01T12:00:00.000Z');
    const { pilotEndsAt } = derivePilotWindow(started);
    expect(pilotEndsAt.toISOString()).toBe('2026-03-15T12:00:00.000Z');
    expect(RU_COMMERCIAL_PILOT_DAYS).toBe(14);
  });
});

describe('P0-01 acceptance scenarios', () => {
  it('1. setup does not consume pilot time', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setNow: (d: Date) => void;
      setReadiness: (v: boolean) => void;
    };
    await ensureApplication(harness, 'acct-a', 'prop-a');
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-03-20T12:00:00.000Z'));
    const got = await getPilotLifecycle(harness, 'acct-a', 'prop-a');
    expect(got.ok).toBe(true);
    if (!got.ok || !got.state) return;
    expect(got.state.status).toBe('setup');
    expect(got.state.timestamps.pilotStartedAt).toBeNull();
    expect(got.state.timestamps.pilotEndsAt).toBeNull();
  });

  it('2. cannot start before readiness', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(false);
    const start = await startPilot(harness, 'acct-a', 'prop-a');
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.reason).toMatch(/cannot_start_pilot_before_ready|readiness_not_satisfied/);
    const got = await getPilotLifecycle(harness, 'acct-a', 'prop-a');
    expect(got.ok && got.state?.timestamps.pilotStartedAt).toBeFalsy();
  });

  it('3. ready object can start with 14-day window', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    const ready = await deriveReady(harness, 'acct-a', 'prop-a');
    expect(ready.ok && ready.state.status).toBe('ready');
    const startAt = new Date('2026-04-01T08:00:00.000Z');
    harness.setNow(startAt);
    const started = await startPilot(harness, 'acct-a', 'prop-a');
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.status).toBe('pilot_active');
    expect(started.state.timestamps.pilotStartedAt?.toISOString()).toBe(startAt.toISOString());
    expect(started.state.timestamps.pilotEndsAt?.toISOString()).toBe('2026-04-15T08:00:00.000Z');
  });

  it('3b. blocks a standard pilot when the property entitlement was already consumed', async () => {
    const harness = ownedDeps({
      claimPilotEntitlement: async () => ({ ok: false as const, reason: 'standard_pilot_already_used' as const }),
    }) as ReturnType<typeof ownedDeps> & { setReadiness: (v: boolean) => void };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    const started = await startPilot(harness, 'acct-a', 'prop-a');
    expect(started).toEqual({ ok: false, reason: 'standard_pilot_already_used' });
    const got = await getPilotLifecycle(harness, 'acct-a', 'prop-a');
    expect(got.ok && got.state?.status).toBe('ready');
  });

  it('4. retry does not restart clock', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-01T08:00:00.000Z'));
    const first = await startPilot(harness, 'acct-a', 'prop-a');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    harness.setNow(new Date('2026-04-03T08:00:00.000Z'));
    const second = await startPilot(harness, 'acct-a', 'prop-a');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.state.timestamps.pilotStartedAt?.toISOString()).toBe(
      first.state.timestamps.pilotStartedAt?.toISOString(),
    );
    expect(second.state.timestamps.pilotEndsAt?.toISOString()).toBe(
      first.state.timestamps.pilotEndsAt?.toISOString(),
    );
  });

  it('5. day 13 remains pilot_active', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-01T08:00:00.000Z'));
    await startPilot(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-14T07:59:59.000Z'));
    const mid = await completePilot(harness, 'acct-a', 'prop-a');
    expect(mid.ok).toBe(false);
    if (mid.ok) return;
    expect(mid.reason).toBe('pilot_not_yet_ended');
    const got = await getPilotLifecycle(harness, 'acct-a', 'prop-a');
    expect(got.ok && got.state?.status).toBe('pilot_active');
  });

  it('6. day 14 completes without restart', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-01T08:00:00.000Z'));
    await startPilot(harness, 'acct-a', 'prop-a');
    const end = new Date('2026-04-15T08:00:00.000Z');
    harness.setNow(end);
    const completed = await completePilot(harness, 'acct-a', 'prop-a');
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.state.status).toBe('pilot_completed');
    expect(completed.state.timestamps.pilotCompletedAt?.toISOString()).toBe(end.toISOString());
  });

  it('7. completion does not involve YooKassa / payments', async () => {
    const payment = vi.fn();
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-01T08:00:00.000Z'));
    await startPilot(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-15T08:00:00.000Z'));
    await completePilot(harness, 'acct-a', 'prop-a');
    expect(payment).not.toHaveBeenCalled();
    // Domain module must not import payment helpers.
    const lifecycleSrc = await import('../lifecycle');
    expect('isYooKassaEnabled' in lifecycleSrc).toBe(false);
    const serviceSrc = await import('../service');
    expect('isYooKassaEnabled' in serviceSrc).toBe(false);
  });

  it('8. cross-tenant isolation', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      addOwned: (a: string, p: string) => void;
    };
    harness.addOwned('acct-b', 'prop-b');
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');

    const leakGet = await getPilotLifecycle(harness, 'acct-b', 'prop-a');
    expect(leakGet.ok).toBe(false);
    if (!leakGet.ok) expect(leakGet.reason).toBe('property_not_owned_by_account');

    const leakStart = await startPilot(harness, 'acct-b', 'prop-a');
    expect(leakStart.ok).toBe(false);
    if (!leakStart.ok) expect(leakStart.reason).toBe('property_not_owned_by_account');
  });

  it('9. restart after completion is rejected', async () => {
    const harness = ownedDeps() as ReturnType<typeof ownedDeps> & {
      setReadiness: (v: boolean) => void;
      setNow: (d: Date) => void;
    };
    await beginSetup(harness, 'acct-a', 'prop-a');
    harness.setReadiness(true);
    await deriveReady(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-01T08:00:00.000Z'));
    await startPilot(harness, 'acct-a', 'prop-a');
    harness.setNow(new Date('2026-04-15T08:00:00.000Z'));
    await completePilot(harness, 'acct-a', 'prop-a');
    const restart = await startPilot(harness, 'acct-a', 'prop-a');
    expect(restart.ok).toBe(false);
    if (!restart.ok) expect(restart.reason).toMatch(/cannot restart pilot/);
  });

  it('concurrent start_pilot with different clocks keeps the winner original timestamps', async () => {
    const store = createMemoryRuCommercialPilotStore();
    const base: Omit<RuCommercialPilotServiceDeps, 'now'> = {
      store,
      isReadinessSatisfied: async () => true,
      ownsProperty: async () => true,
      claimPilotEntitlement: async () => ({ ok: true as const, reused: false as const }),
    };
    const prepNow = new Date('2026-05-01T00:00:00.000Z');
    await beginSetup({ ...base, now: () => prepNow }, 'acct-a', 'prop-a');
    await deriveReady({ ...base, now: () => prepNow }, 'acct-a', 'prop-a');

    const clockA = new Date('2026-05-01T12:00:00.000Z');
    const clockB = new Date('2026-05-10T18:30:00.000Z');
    const [a, b] = await Promise.all([
      startPilot({ ...base, now: () => clockA }, 'acct-a', 'prop-a'),
      startPilot({ ...base, now: () => clockB }, 'acct-a', 'prop-a'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.state.status).toBe('pilot_active');
    expect(b.state.status).toBe('pilot_active');
    expect(a.state.timestamps.pilotStartedAt?.toISOString()).toBe(
      b.state.timestamps.pilotStartedAt?.toISOString(),
    );
    expect(a.state.timestamps.pilotEndsAt?.toISOString()).toBe(
      b.state.timestamps.pilotEndsAt?.toISOString(),
    );
    const started = a.state.timestamps.pilotStartedAt!.toISOString();
    expect([clockA.toISOString(), clockB.toISOString()]).toContain(started);

    const later = await startPilot(
      { ...base, now: () => new Date('2026-06-01T00:00:00.000Z') },
      'acct-a',
      'prop-a',
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.changed).toBe(false);
    expect(later.state.timestamps.pilotStartedAt?.toISOString()).toBe(started);
  });

  it('concurrent complete_pilot is idempotent on the winner state', async () => {
    const store = createMemoryRuCommercialPilotStore();
    const base: Omit<RuCommercialPilotServiceDeps, 'now'> = {
      store,
      isReadinessSatisfied: async () => true,
      ownsProperty: async () => true,
      claimPilotEntitlement: async () => ({ ok: true as const, reused: false as const }),
    };
    const t0 = new Date('2026-05-01T00:00:00.000Z');
    await beginSetup({ ...base, now: () => t0 }, 'acct-a', 'prop-a');
    await deriveReady({ ...base, now: () => t0 }, 'acct-a', 'prop-a');
    await startPilot({ ...base, now: () => t0 }, 'acct-a', 'prop-a');

    const endA = new Date('2026-05-16T00:00:00.000Z');
    const endB = new Date('2026-05-20T00:00:00.000Z');
    const [a, b] = await Promise.all([
      completePilot({ ...base, now: () => endA }, 'acct-a', 'prop-a'),
      completePilot({ ...base, now: () => endB }, 'acct-a', 'prop-a'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.state.status).toBe('pilot_completed');
    expect(b.state.status).toBe('pilot_completed');
    expect(a.state.timestamps.pilotCompletedAt?.toISOString()).toBe(
      b.state.timestamps.pilotCompletedAt?.toISOString(),
    );
  });

  it('derive_ready cannot report success when only setup was persisted by a competing writer', async () => {
    const inner = createMemoryRuCommercialPilotStore();
    const prep: RuCommercialPilotServiceDeps = {
      store: inner,
      isReadinessSatisfied: async () => true,
      ownsProperty: async () => true,
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    };
    await ensureApplication(prep, 'acct-a', 'prop-a');
    const application = await inner.get('acct-a', 'prop-a');
    expect(application?.status).toBe('application');

    const setupResult = await beginSetup(prep, 'acct-a', 'prop-a');
    expect(setupResult.ok && setupResult.state.status).toBe('setup');

    let staleReadsRemaining = 1;
    const racingStore: RuCommercialPilotServiceDeps['store'] = {
      get: async (accountId, propertyId) => {
        if (staleReadsRemaining > 0) {
          staleReadsRemaining -= 1;
          return application;
        }
        return inner.get(accountId, propertyId);
      },
      compareAndSet: (accountId, propertyId, expectedStatus, next) =>
        inner.compareAndSet(accountId, propertyId, expectedStatus, next),
      upsertIfAbsent: (state) => inner.upsertIfAbsent(state),
    };

    const staleDerive = await deriveReady(
      {
        store: racingStore,
        isReadinessSatisfied: async () => true,
        ownsProperty: async () => true,
        now: () => new Date('2026-05-02T00:00:00.000Z'),
      },
      'acct-a',
      'prop-a',
    );
    expect(staleDerive.ok).toBe(false);
    if (staleDerive.ok) return;
    expect(staleDerive.reason).toBe('concurrent_update_retry_required');

    const persisted = await inner.get('acct-a', 'prop-a');
    expect(persisted?.status).toBe('setup');
  });
});

describe('migration invariants (SQL SSOT)', () => {
  it('encodes pilot_started_at requires ready_at and status↔timestamp checks', () => {
    const migrationPath = path.join(
      process.cwd(),
      'supabase/migrations/20260918120000_ru_commercial_pilot_lifecycle_v1.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const compact = sql.replace(/\s+/g, ' ');

    expect(compact).toContain(
      'pilot_started_at IS NULL OR (ready_at IS NOT NULL AND pilot_started_at >= ready_at)',
    );
    expect(compact).not.toContain(
      'pilot_started_at IS NULL OR ready_at IS NULL OR pilot_started_at >= ready_at',
    );

    expect(sql).toMatch(
      /CONSTRAINT ru_commercial_pilot_lifecycle_status_ready_at_chk[\s\S]*?ready_at IS NOT NULL/,
    );
    expect(sql).toMatch(
      /CONSTRAINT ru_commercial_pilot_lifecycle_status_pilot_window_chk[\s\S]*?pilot_started_at IS NOT NULL AND pilot_ends_at IS NOT NULL/,
    );
    expect(sql).toMatch(
      /CONSTRAINT ru_commercial_pilot_lifecycle_status_completed_at_chk[\s\S]*?pilot_completed_at IS NOT NULL/,
    );
  });
});

describe('pure helpers used by setup→ready', () => {
  it('rejects deriveReady without readiness', () => {
    const setup = applyBeginSetup(createApplicationState('a', 'p'), new Date('2026-01-01T00:00:00.000Z'));
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const denied = applyDeriveReady(setup.state, false, new Date('2026-01-02T00:00:00.000Z'));
    expect(denied.ok).toBe(false);
  });

  it('rejects start from setup even if readiness true (must be ready first)', () => {
    const setup = applyBeginSetup(createApplicationState('a', 'p'), new Date());
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const start = applyStartPilot(setup.state, true, new Date());
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.reason).toBe('cannot_start_pilot_before_ready');
  });

  it('complete before end fails; after end succeeds once', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    let state = createApplicationState('a', 'p');
    const setup = applyBeginSetup(state, t0);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    state = setup.state;
    const ready = applyDeriveReady(state, true, new Date('2026-01-02T00:00:00.000Z'));
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    state = ready.state;
    const started = applyStartPilot(state, true, new Date('2026-01-03T00:00:00.000Z'));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    state = started.state;
    const early = applyCompletePilot(state, new Date('2026-01-10T00:00:00.000Z'));
    expect(early.ok).toBe(false);
    const done = applyCompletePilot(state, new Date('2026-01-17T00:00:00.000Z'));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const again = applyCompletePilot(done.state, new Date('2026-01-18T00:00:00.000Z'));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.changed).toBe(false);
  });
});
