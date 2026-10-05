import { evaluateCommunicationFacts, sameCommunicationScope, type CommunicationFactsResult,
  type CommunicationFactScope, type FactReason } from '../communication/knowledge-provenance';
import type { ProcessResult } from '../communication/types';
import { makeDecision, type DecisionIdentity, type DecisionReason, type DecisionEvidence, type PlatformDecision } from './decision';

const reasonMap: Record<FactReason, DecisionReason> = {
  verified: 'verified', missing: 'missing', scope_mismatch: 'scope_mismatch', malformed: 'malformed',
  stale: 'stale', conflicting: 'conflicting', sensitive: 'sensitive', untrusted: 'untrusted',
  dependency_failed: 'unavailable', ownership_changed: 'state_changed', operator_controlled: 'operator_controlled',
};
/** Input must be a result of the Wave 2 authoritative binding/resolver, not caller-provided facts. */
export function adaptCommunicationDecision(input: {
  identity: DecisionIdentity; result: CommunicationFactsResult | null; now: number;
  process?: Pick<ProcessResult, 'outcome'>;
}): PlatformDecision {
  const { identity, result, now } = input;
  if (identity.kind === 'unidentified') return makeDecision({ identity, topic: 'communication', now,
    status: 'review_required', reasons: ['identity_unresolved'], allowedActions: ['clarify_identity'], limitations: ['draft_only'] });
  const scope: CommunicationFactScope = { accountId: identity.accountId, propertyId: identity.propertyId,
    ...(identity.bookingId ? { bookingId: identity.bookingId } : {}),
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
    ...(identity.guestId ? { guestId: identity.guestId } : {}) };
  const fail = (reason: DecisionReason, unavailable = false) => makeDecision({ identity, topic: 'communication', now,
    status: unavailable ? 'unavailable' : 'review_required', reasons: [reason], blockers: [reason], limitations: ['draft_only'] });
  if (!result) return fail('unavailable', true);
  if (!result.scope || !sameCommunicationScope(scope, result.scope)) return fail('scope_mismatch');
  if (!Array.isArray(result.decisions) || !result.decisions.length
    || result.decisions.some(d => !d || typeof d.key !== 'string' || !d.key.trim() || !Object.hasOwn(reasonMap, d.reason)
      || !['automatic', 'operator_review', 'unusable'].includes(d.use))) return fail('malformed');
  const facts = result.decisions.flatMap(d => d.fact ? [d.fact] : []);
  if (facts.some(f => !f || !f.scope || !sameCommunicationScope(scope, f.scope))) return fail('scope_mismatch');
  // Re-evaluate surviving facts at the current time, never refresh their observedAt.
  const current = evaluateCommunicationFacts({ scope: scope as CommunicationFactScope,
    requestedFacts: result.decisions.map(d => d.key), facts, now });
  const reasons: DecisionReason[] = [];
  const evidence: DecisionEvidence[] = [];
  result.decisions.forEach((d, index) => {
    const evaluated = current.decisions.find(c => c.key === d.key);
    const usable = d.use === 'automatic' && d.reason === 'verified' && evaluated?.use === 'automatic';
    if (!usable) reasons.push(reasonMap[d.use === 'automatic' ? evaluated?.reason ?? 'malformed' : d.reason]);
    if (usable && evaluated?.fact) evidence.push({ source: 'communication_facts', index,
      observedAt: evaluated.fact.observedAt,
      origin: ['canonical', 'external', 'manual'].includes(evaluated.fact.origin)
        ? evaluated.fact.origin as 'canonical' | 'external' | 'manual' : 'unknown' });
  });
  if (input.process && !['replied', 'duplicate', 'ignored', 'error'].includes(input.process.outcome)) return fail('malformed');
  if (input.process?.outcome === 'error') return fail('process_error', true);
  if (input.process?.outcome === 'duplicate' || input.process?.outcome === 'ignored') {
    return makeDecision({ identity, topic: 'communication', now, status: 'review_required',
      reasons: ['process_noop'], allowedActions: [], limitations: ['draft_only'] });
  }
  if (!result.ready && !reasons.length) reasons.push('operator_controlled');
  const failed = reasons.length > 0;
  const unavailable = reasons.includes('unavailable');
  return makeDecision({ identity, topic: 'communication', now,
    status: unavailable ? 'unavailable' : failed ? 'review_required' : 'allowed',
    trust: unavailable ? 'unavailable' : reasons.includes('conflicting') ? 'conflicting' : failed ? 'review_required' : 'verified',
    reasons: failed ? reasons : ['verified', 'draft_only'], blockers: failed ? reasons : [], evidence,
    limitations: ['draft_only'], allowedActions: failed ? ['request_operator_review'] : ['prepare_operator_draft'] });
}
