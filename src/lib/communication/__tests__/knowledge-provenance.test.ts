import { describe, it, expect, vi } from 'vitest';
import { evaluateCommunicationFacts, resolveCommunicationFacts, communicationFactReviewSummary,
  type CommunicationFact, type CommunicationFactScope } from '../knowledge-provenance';
const now = Date.parse('2026-10-01T12:00:00Z');
const scope: CommunicationFactScope = { accountId: 'a', propertyId: 'p', bookingId: 'b', sessionId: 's', guestId: 'g' };
const fact = (overrides: Partial<CommunicationFact> = {}): CommunicationFact => ({
  key: 'checkout_time', value: '12:00', scope: { ...scope }, origin: 'canonical',
  source: 'property', reference: 'row-1', observedAt: new Date(now).toISOString(),
  verified: true, sensitivity: 'normal', ...overrides,
});
const evaluate = (facts: unknown, key = 'checkout_time') =>
  evaluateCommunicationFacts({ scope, requestedFacts: [key], facts, now });
describe('communication provenance adversarial boundary', () => {
  it('keeps verified non-sensitive canonical facts usable', () => {
    expect(evaluate([fact()])).toMatchObject({ ready: true, decisions: [{ use: 'automatic' }] });
  });
  it.each(['accountId', 'propertyId', 'bookingId', 'sessionId', 'guestId'] as const)('rejects foreign %s', (key) => {
    const result = evaluate([fact({ scope: { ...scope, [key]: 'foreign' } })]);
    expect(result).toMatchObject({ ready: false, decisions: [{ reason: 'scope_mismatch' }] });
    expect(JSON.stringify(result)).not.toContain('12:00');
  });
  it.each(['wifi', 'access', 'booking_state', 'deposit'])('does not invent missing %s', (key) => {
    expect(evaluate([], key)).toMatchObject({ ready: false, decisions: [{ reason: 'missing' }] });
  });
  it.each(['synthetic', 'unknown', 'inferred', 'guest', 'cached'] as const)('rejects %s as operational authority', (origin) => {
    expect(evaluate([fact({ origin })]).ready).toBe(false);
  });
  it('does not allow synthetic facts to fill another requested key', () => {
    expect(evaluateCommunicationFacts({ scope, requestedFacts: ['checkout_time', 'address'], now,
      facts: [fact(), fact({ key: 'address', origin: 'synthetic' })] }).ready).toBe(false);
  });
  it('current canonical truth beats old guest memory', () => {
    const result = evaluate([fact({ origin: 'guest', value: '18:00' }), fact()]);
    expect(result.decisions[0].fact?.value).toBe('12:00');
  });
  it('conflicting verified sources require review', () => {
    expect(evaluate([fact(), fact({ origin: 'manual', value: '14:00' })]))
      .toMatchObject({ ready: false, decisions: [{ reason: 'conflicting' }] });
  });
  it.each([-31 * 86400_000, 1])('rejects stale/future timestamps (%s)', (delta) => {
    expect(evaluate([fact({ observedAt: new Date(now + delta).toISOString() })]).ready).toBe(false);
  });
  it('volatile state has a short lifetime', () => {
    expect(evaluate([fact({ key: 'cleaning', observedAt: new Date(now - 61_000).toISOString() })], 'cleaning').ready).toBe(false);
  });
  it.each(['access', 'wifi', 'deposit', 'document', 'contract', 'guest_data'])('never automatically discloses %s', (key) => {
    const result = evaluate([fact({ key, value: 'SECRET' })], key);
    expect(result.decisions[0].reason).toBe('sensitive');
    expect(communicationFactReviewSummary(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it.each([null, {}, [{ key: 'address' }], [fact({ value: NaN })], [fact({ observedAt: 'invalid' })]])
    ('rejects malformed evidence %#', (facts) => expect(evaluate(facts).ready).toBe(false));
  it('malformed mixed with valid evidence fails the whole batch', () => {
    expect(evaluate([fact(), { key: 'address' }]).ready).toBe(false);
  });
  it('false is a fact, not absence', () => {
    expect(evaluate([fact({ key: 'cleaning', value: false })], 'cleaning').decisions[0].reason).toBe('untrusted');
  });
  it('ownership changes during retrieval fail closed', async () => {
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] },
      { authorize, load: async () => [fact()], now: () => now });
    expect(result.decisions[0].reason).toBe('ownership_changed');
  });
  it.each(['authorize', 'load'] as const)('fails closed on %s error without raw error leakage', async (failure) => {
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
      authorize: async () => { if (failure === 'authorize') throw new Error('SECRET'); return true; },
      load: async () => { throw new Error('SECRET'); }, now: () => now,
    });
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('shared caller identity cannot be rebound during load', async () => {
    const shared = { ...scope };
    const result = await resolveCommunicationFacts({ scope: shared, requestedFacts: ['checkout_time'] }, {
      authorize: async () => true,
      load: async () => { shared.accountId = 'foreign'; return [fact({ scope: shared })]; }, now: () => now,
    });
    expect(result.decisions[0].reason).toBe('scope_mismatch');
  });
  it('dependency cannot mutate its scope input', async () => {
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
      authorize: async () => true,
      load: async (given) => { (given as { accountId: string }).accountId = 'foreign'; return [fact()]; },
      now: () => now,
    });
    expect(result.ready).toBe(false);
  });
  it('snapshots cached evidence before the final ownership await', async () => {
    const cached = fact();
    let calls = 0;
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
      authorize: async () => { if (++calls === 2) cached.value = 'corrupted'; return true; },
      load: async () => [cached], now: () => now,
    });
    expect(result.decisions[0].fact?.value).toBe('12:00');
  });
});

describe('review evidence stays tenant scoped', () => {
  it('keeps verified scope for an unavailable provider so the correct operator can see the failure', async () => {
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
      authorize: async () => true, load: async () => { throw new Error('provider down'); }, now: () => now,
    });
    expect(result).toMatchObject({ ready: false, scope, decisions: [{ reason: 'dependency_failed' }] });
  });
  it('does not attach a newly changed owner to the review', async () => {
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
      authorize: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      load: async () => [], now: () => now,
    });
    expect(result.scope).toBeUndefined();
  });
  it('sensitive contents cannot hide behind a normal field label', () => {
    expect(evaluate([fact({ value: 'Door code: 1234', sensitivity: 'normal' })]))
      .toMatchObject({ ready: false, decisions: [{ reason: 'sensitive' }] });
  });
});

describe('bounded dependency failure', () => {
  it.each(['authorize', 'load'] as const)('a stalled %s cannot hang preparation indefinitely', async (stalled) => {
    vi.useFakeTimers();
    try {
      const pending = resolveCommunicationFacts({ scope, requestedFacts: ['checkout_time'] }, {
        authorize: () => stalled === 'authorize' ? new Promise<boolean>(() => {}) : Promise.resolve(true),
        load: () => new Promise<unknown>(() => {}), now: () => now,
      });
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await pending).decisions[0].reason).toBe('dependency_failed');
    } finally { vi.useRealTimers(); }
  });
});
