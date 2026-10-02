import type { SpatialValidation } from '../location/spatial-validation-types';
import { validateSpatialEvidence, sameSpatialScope } from '../location/spatial-validation';
import { isFresh, makeDecision, type DecisionReason, type DecisionEvidence, type PlatformDecision } from './decision';
import { snapshotProblem, type IdentifiedScope, type ScopedSnapshot } from './snapshot';

/** Wave 1 remains the spatial validator; this adapter neither scores nor loads providers. */
export function adaptResidentialLocationDecision(identity: IdentifiedScope, snapshot: ScopedSnapshot<SpatialValidation>, now: number): PlatformDecision {
  const fail = (reason: DecisionReason, unavailable = false) => makeDecision({ identity, topic: 'location', now,
    status: unavailable ? 'unavailable' : 'review_required', reasons: [reason], blockers: [reason] });
  const problem = snapshotProblem(identity, snapshot, now);
  if (problem || !snapshot.available) return fail(problem ?? 'unavailable', true);
  const original = snapshot.value;
  if (!original || original.mode !== 'residential') return fail('residential_only');
  const scope = { kind: 'account' as const, accountId: identity.accountId, locationId: identity.propertyId };
  if (!original.scope || !sameSpatialScope(scope, original.scope)) return fail('scope_mismatch');
  if (!original.location) return fail('provider_unavailable', true);
  if (original.location.mode !== 'residential' || original.location.objectKind !== 'property'
    || !['RU', 'Russia', 'Россия', 'Российская Федерация'].includes(original.location.country ?? '')) return fail('residential_only');
  if (!sameSpatialScope(scope, original.location.scope)
    || !Array.isArray(original.evidence) || original.evidence.some(e => !sameSpatialScope(scope, e.scope) || e.mode !== 'residential')) return fail('scope_mismatch');
  try {
    if (!Array.isArray(original.blockers) || !Array.isArray(original.warnings) || !Array.isArray(original.manualControls)
      || typeof original.ok !== 'boolean' || typeof original.automated !== 'boolean'
      || typeof original.requiresOperatorReview !== 'boolean') return fail('malformed');
    const current = validateSpatialEvidence({ scope, mode: 'residential', purpose: original.purpose,
      radiusMeters: original.radiusMeters }, original.location, original.evidence, new Date(now));
    const codes = [...original.blockers, ...current.blockers];
    const unavailable = codes.some(c => ['provider_available', 'spatial_dependency_unavailable', 'nearby_evidence_available'].includes(c));
    const stale = [original.location.source, ...original.evidence.map(e => e.source),
      ...original.evidence.flatMap(e => e.entities.map(entity => entity.source))]
      .some(s => !s || !isFresh(s.observedAt, now, 86_400_000));
    const spatialCodes = new Set(['address_available', 'coordinates_valid', 'address_coordinates_consistent',
      'geography_available', 'location_provenance', 'evidence_provenance', 'entity_provenance',
      'evidence_radius_scope', 'conflicting_entity_evidence', 'confirm_address_and_map_point',
      'operator_verified_spatial_evidence', 'partial_provider_coverage', 'verify_missing_map_coverage']);
    const safeSpatialReason = (code: string, fallback: DecisionReason): DecisionReason =>
      spatialCodes.has(code) ? code as DecisionReason : fallback;
    const blockers: DecisionReason[] = codes.map(c => safeSpatialReason(c, 'spatial_blocker'));
    if (stale) blockers.push('stale');
    if (unavailable) blockers.push('provider_unavailable');
    const warnings: DecisionReason[] = [...original.warnings, ...current.warnings].map(c => safeSpatialReason(c, 'spatial_warning'));
    const manual: DecisionReason[] = [...original.manualControls, ...current.manualControls].map(c => safeSpatialReason(c, 'spatial_manual'));
    const review = !original.ok || !original.automated || original.requiresOperatorReview || !current.automated || warnings.length > 0;
    const evidence: DecisionEvidence[] = current.provenance.map((s, index) => ({
      source: 'spatial_validation', index, observedAt: s.observedAt, origin: s.origin === 'manual' ? 'manual' : 'external',
    }));
    return makeDecision({ identity, topic: 'location', now,
      status: unavailable ? 'unavailable' : blockers.length ? 'blocked' : review ? 'review_required' : 'allowed',
      reasons: blockers.length ? blockers : review ? (manual.length ? manual : ['spatial_manual']) : ['verified'],
      blockers, limitations: warnings, manualControls: manual, evidence,
      allowedActions: blockers.length ? ['request_operator_review'] : ['review_location'] });
  } catch {
    return fail('malformed', true);
  }
}
