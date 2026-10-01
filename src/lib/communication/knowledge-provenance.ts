/** Server-side communication fact boundary. No IO, prompts or transport policy here. */
export type CommunicationFactScope = Readonly<{
  accountId: string; propertyId: string;
  bookingId?: string; sessionId?: string; guestId?: string;
}>;
export type FactOrigin = 'canonical' | 'external' | 'manual' | 'guest' | 'inferred' | 'cached' | 'synthetic' | 'unknown';
export type FactUse = 'automatic' | 'operator_review' | 'unusable';
export type FactReason = 'verified' | 'missing' | 'scope_mismatch' | 'malformed' | 'stale'
  | 'conflicting' | 'sensitive' | 'untrusted' | 'dependency_failed' | 'ownership_changed' | 'operator_controlled';
export type CommunicationFact = {
  key: string; value: string | number | boolean; scope: CommunicationFactScope;
  origin: FactOrigin; source: string; reference: string; observedAt: string;
  validFrom?: string; validUntil?: string;
  verified: boolean; sensitivity: 'normal' | 'personal' | 'access' | 'financial' | 'legal';
};
export type FactDecision = {
  key: string; use: FactUse; reason: FactReason;
  /** Values never appear in review summaries or failed decisions. */
  fact?: CommunicationFact;
};
export type CommunicationFactsResult = {
  ready: boolean; decisions: FactDecision[];
  /** Present only after both authoritative ownership checks succeed. */
  scope?: CommunicationFactScope;
};
const dimensions = ['accountId', 'propertyId', 'bookingId', 'sessionId', 'guestId'] as const;
const origins: FactOrigin[] = ['canonical', 'external', 'manual', 'guest', 'inferred', 'cached', 'synthetic', 'unknown'];
const sensitivities = ['normal', 'personal', 'access', 'financial', 'legal'];
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function sameCommunicationScope(a: CommunicationFactScope, b: CommunicationFactScope): boolean {
  return dimensions.every((key) => a[key] === b[key]);
}
function validScope(value: unknown): value is CommunicationFactScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Record<string, unknown>;
  return nonempty(scope.accountId) && nonempty(scope.propertyId)
    && dimensions.every((key) => scope[key] === undefined || nonempty(scope[key]));
}
function validFact(value: unknown): value is CommunicationFact {
  if (!value || typeof value !== 'object') return false;
  const fact = value as CommunicationFact;
  return nonempty(fact.key) && validScope(fact.scope) && origins.includes(fact.origin)
    && nonempty(fact.source) && nonempty(fact.reference)
    && nonempty(fact.observedAt) && Number.isFinite(Date.parse(fact.observedAt))
    && (fact.validFrom === undefined || Number.isFinite(Date.parse(fact.validFrom)))
    && (fact.validUntil === undefined || Number.isFinite(Date.parse(fact.validUntil)))
    && typeof fact.verified === 'boolean' && sensitivities.includes(fact.sensitivity)
    && (nonempty(fact.value) || typeof fact.value === 'boolean'
      || (typeof fact.value === 'number' && Number.isFinite(fact.value)));
}
function failure(keys: readonly string[], reason: FactReason): CommunicationFactsResult {
  return { ready: false, decisions: keys.map((key) => ({ key, use: 'unusable', reason })) };
}
// Operational state cannot inherit the longer property-instruction lifetime.
const propertyKeys = new Set(['address', 'house_rules', 'parking', 'checkout_time', 'support']);
const sensitiveKeys = /wifi|password|access|door|keys|document|passport|payment|deposit|refund|contract|legal|guest_data/i;
export function evaluateCommunicationFacts(input: {
  scope: CommunicationFactScope; requestedFacts: readonly string[]; facts: unknown; now: number;
}): CommunicationFactsResult {
  const keys = [...new Set(input.requestedFacts)];
  if (!keys.length || !validScope(input.scope) || !Number.isFinite(input.now)) return failure(keys, 'malformed');
  if (!Array.isArray(input.facts) || !input.facts.every(validFact)) return failure(keys, 'malformed');
  const facts: CommunicationFact[] = input.facts;
  // Do not silently drop foreign/invalid items from an otherwise plausible batch.
  if (facts.some((fact) => !sameCommunicationScope(input.scope, fact.scope))) return failure(keys, 'scope_mismatch');
  const decisions = keys.map((key): FactDecision => {
    const candidates = facts.filter((fact) => fact.key === key);
    if (!candidates.length) return { key, use: 'operator_review', reason: 'missing' };
    if (propertyKeys.has(key) && candidates.some((fact) => !nonempty(fact.value))) {
      return { key, use: 'unusable', reason: 'malformed' };
    }
    // Old guest memory/inference cannot override or fill current operational truth.
    const trusted = candidates.filter((fact) => fact.verified && ['canonical', 'external', 'manual'].includes(fact.origin));
    if (!trusted.length) return { key, use: 'operator_review', reason: 'untrusted' };
    const fresh = trusted.filter((fact) => {
      const age = input.now - Date.parse(fact.observedAt);
      return age >= 0 && age <= (propertyKeys.has(key) ? 30 * 86400_000 : 60_000)
        && (fact.validFrom === undefined || input.now >= Date.parse(fact.validFrom))
        && (fact.validUntil === undefined || input.now <= Date.parse(fact.validUntil));
    });
    if (!fresh.length) return { key, use: 'operator_review', reason: 'stale' };
    if (new Set(fresh.map((fact) => JSON.stringify(fact.value))).size > 1) {
      return { key, use: 'operator_review', reason: 'conflicting' };
    }
    if (sensitiveKeys.test(key) || fresh.some((fact) => fact.sensitivity !== 'normal'
      || /password|парол|door.?code|код\s+(?:двер|замк)|passport|паспорт|refund|возврат.*залог/iu.test(String(fact.value)))) {
      return { key, use: 'operator_review', reason: 'sensitive' };
    }
    // Volatile runtime state needs a dedicated authoritative adapter, not a generic row.
    if (!propertyKeys.has(key)) return { key, use: 'operator_review', reason: 'untrusted' };
    const chosen = fresh.find((fact) => fact.origin === 'canonical') ?? fresh[0];
    return { key, use: 'automatic', reason: 'verified', fact: { ...chosen, scope: { ...chosen.scope } } };
  });
  return { ready: decisions.every((decision) => decision.use === 'automatic'), decisions };
}
export async function readCommunicationDependency<T>(load: () => PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(load),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('knowledge_timeout')), 5_000); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}export type CommunicationFactDependencies = {
  authorize: (scope: CommunicationFactScope) => Promise<boolean>;
  load: (scope: CommunicationFactScope, keys: readonly string[]) => Promise<unknown>;
  now: () => number;
};
export async function resolveCommunicationFacts(input: {
  scope: CommunicationFactScope; requestedFacts: readonly string[];
}, dependencies: CommunicationFactDependencies): Promise<CommunicationFactsResult> {
  // Independent immutable identity: provider and caller references must never rebind it.
  const scope = Object.freeze({ ...input.scope });
  const keys = Object.freeze([...new Set(input.requestedFacts)]);
  if (!validScope(scope)) return failure(keys, 'scope_mismatch');
  try {
    if (!await readCommunicationDependency(() => dependencies.authorize(Object.freeze({ ...scope })))) return failure(keys, 'scope_mismatch');
    let snapshot: unknown;
    let failed = false;
    try {
      const evidence = await readCommunicationDependency(() => dependencies.load(Object.freeze({ ...scope }), Object.freeze([...keys])));
      // Snapshot before the second await: shared provider objects cannot change under us.
      snapshot = structuredClone(evidence);
    } catch {
      failed = true;
    }
    if (!await readCommunicationDependency(() => dependencies.authorize(Object.freeze({ ...scope })))) return failure(keys, 'ownership_changed');
    const result = failed ? failure(keys, 'dependency_failed')
      : evaluateCommunicationFacts({ scope, requestedFacts: keys, facts: snapshot, now: dependencies.now() });
    return { ...result, scope: { ...scope } };
  } catch {
    return failure(keys, 'dependency_failed');
  }
}
export function communicationFactReviewSummary(result: CommunicationFactsResult): string {
  // Deliberately omit values, guest identifiers, provider error text and references.
  return result.decisions.map(({ key, reason }) => key + ': ' + reason).join('; ');
}
