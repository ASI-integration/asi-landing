import { describe, expect, it, vi } from 'vitest';
import { ACTIONS, explainDecision, isPlatformDecision, makeDecision, parsePlatformDecision } from '../decision';
import { readStableSnapshot, type IdentifiedScope } from '../snapshot';
const now = Date.parse('2026-10-02T15:00:00Z');
const observedAt = new Date(now).toISOString();
const identity: IdentifiedScope = { kind: 'identified', accountId: 'A', propertyId: 'P', bookingId: 'B' };
const good = () => makeDecision({ identity, topic: 'communication', status: 'allowed', now,
  reasons: ['verified'], allowedActions: ['prepare_operator_draft'],
  evidence: [{ source: 'communication_facts', index: 0, observedAt, origin: 'canonical' }] });
type Mutable = Record<string, any>;
describe('PlatformDecision strict contract', () => {
  it('serializes, validates, explains and deeply freezes a minimal real decision', () => {
    const d = good();
    expect(isPlatformDecision(JSON.parse(JSON.stringify(d)))).toBe(true);
    expect(explainDecision(d)).toContain('Canonical evidence');
    expect(Object.isFrozen(d.identity)).toBe(true);
    expect(Object.isFrozen(d.permission.allowedActions)).toBe(true);
    expect(d.permission.forbiddenActions).toContain('send_guest_automatically');
  });
  it.each([
    ['empty', (d: Mutable) => { for (const k of Object.keys(d)) delete d[k]; }],
    ['identity', (d: Mutable) => { d.identity.accountId = ''; }],
    ['extra identity', (d: Mutable) => { d.identity.password = 'DO_NOT_LEAK'; }],
    ['state', (d: Mutable) => { d.status = 'probably'; }],
    ['evidence value', (d: Mutable) => { d.evidence[0].value = 'DO_NOT_LEAK'; }],
    ['secret URL', (d: Mutable) => { d.evidence[0].reference = 'https://secret'; }],
    ['free reason', (d: Mutable) => { d.audit.reasons = ['passport DO_NOT_LEAK']; }],
    ['automatic flag', (d: Mutable) => { d.permission.automaticActionAllowed = true; }],
    ['conflicting actions', (d: Mutable) => { d.permission.forbiddenActions.push('prepare_operator_draft'); }],
    ['missing prohibition', (d: Mutable) => { d.permission.forbiddenActions.pop(); }],
    ['no reason', (d: Mutable) => { d.audit.reasons = []; }],
    ['no evidence', (d: Mutable) => { d.evidence = []; }],
    ['false ready', (d: Mutable) => { d.blockers = ['missing']; }],
    ['untrusted ready', (d: Mutable) => { d.trust = 'unavailable'; }],
    ['wrong domain', (d: Mutable) => { d.domain = 'residential_ops'; }],
    ['bad date', (d: Mutable) => { d.evidence[0].observedAt = 'yesterday'; }],
    ['blocked without review', (d: Mutable) => { d.status = 'blocked'; }],
  ] as const)('rejects %s', (_name, mutate) => {
    const d: Mutable = JSON.parse(JSON.stringify(good()));
    mutate(d);
    expect(isPlatformDecision(d)).toBe(false);
    expect(() => parsePlatformDecision(d)).toThrow('invalid_platform_decision');
  });
  it('cannot grant communication access-release permission', () => {
    expect(() => makeDecision({ identity, topic: 'communication', now, status: 'allowed',
      reasons: ['verified'], allowedActions: ['release_access'] })).toThrow();
  });
  it('cannot grant blocked closeout or automatic sending', () => {
    for (const action of ['close_booking', 'send_guest_automatically'] as const) {
      expect(() => makeDecision({ identity, topic: 'closeout', now, status: 'blocked',
        reasons: ['missing'], allowedActions: [action] })).toThrow();
    }
  });
  it('requires an exhaustive disjoint permission partition', () => {
    const d = good();
    expect(new Set([...d.permission.allowedActions, ...d.permission.forbiddenActions]).size).toBe(ACTIONS.length);
  });
});
describe('awaited canonical snapshot boundary', () => {
  it('freezes original scope and copies the payload before revalidation awaits', async () => {
    const caller = { ...identity }, payload = { status: 'ready' };
    let calls = 0;
    const result = await readStableSnapshot(caller, {
      now: () => now,
      readVersion: async scope => {
        calls++;
        expect(scope.propertyId).toBe('P'); expect(Object.isFrozen(scope)).toBe(true);
        if (calls === 2) { caller.propertyId = 'OTHER'; payload.status = 'blocked'; }
        return { identity: { ...identity }, revision: 'v1', observedAt };
      },
      load: async () => payload,
    });
    expect(result).toMatchObject({ available: true, identity, value: { status: 'ready' } });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(['account', 'property', 'booking', 'readiness', 'deposit', 'incident'] as const)('rejects %s changes during await', async attack => {
    let calls = 0;
    const result = await readStableSnapshot(identity, {
      now: () => now,
      readVersion: async () => {
        calls++;
        const changed = { ...identity };
        if (calls === 2 && attack === 'account') changed.accountId = 'OTHER';
        if (calls === 2 && attack === 'property') changed.propertyId = 'OTHER';
        if (calls === 2 && attack === 'booking') changed.bookingId = 'OTHER';
        return { identity: changed, revision: calls === 2 && ['readiness', 'deposit', 'incident'].includes(attack) ? 'v2' : 'v1', observedAt };
      },
      load: async () => ({ status: 'ready' }),
    });
    expect(result).toEqual({ available: false, reason: 'state_changed' });
  });
  it('fails before loading foreign state', async () => {
    const load = vi.fn();
    expect(await readStableSnapshot(identity, { now: () => now, load,
      readVersion: async () => ({ identity: { ...identity, accountId: 'X' }, revision: 'v1', observedAt }),
    })).toEqual({ available: false, reason: 'scope_mismatch' });
    expect(load).not.toHaveBeenCalled();
  });
  it('rechecks freshness after await and never exposes provider exceptions', async () => {
    let clock = now;
    expect(await readStableSnapshot(identity, {
      now: () => clock, readVersion: async () => ({ identity, revision: 'v1', observedAt }),
      load: async () => { clock += 60_001; return {}; },
    })).toEqual({ available: false, reason: 'stale' });
    expect(await readStableSnapshot(identity, {
      now: () => now, readVersion: async () => { throw new Error('DO_NOT_LEAK'); }, load: async () => ({}),
    })).toEqual({ available: false, reason: 'unavailable' });
  });
});
