import { haversineMeters } from './geometry';
import type { Coordinates, SpatialEvidence, SpatialLocation, SpatialRequest, SpatialScope, SpatialSource, SpatialValidation } from './spatial-validation-types';

export const SPATIAL_RADIUS_MIN_METERS = 1000;
export const SPATIAL_RADIUS_MAX_METERS = 5000;
export const SPATIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function validCoordinates(p: Coordinates | null | undefined): p is Coordinates {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
export function validSpatialRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius >= SPATIAL_RADIUS_MIN_METERS && radius <= SPATIAL_RADIUS_MAX_METERS;
}
export function sameSpatialScope(a: SpatialScope, b: SpatialScope): boolean {
  return a.kind === b.kind && a.locationId === b.locationId
    && (a.kind !== 'account' || (b.kind === 'account' && a.accountId === b.accountId));
}
export function validSpatialRequest(r: SpatialRequest): boolean {
  return ['residential', 'commercial'].includes(r.mode)
    && ['map_preview', 'site_assessment'].includes(r.purpose)
    && ['public', 'account'].includes(r.scope.kind) && !!r.scope.locationId?.trim()
    && (r.scope.kind !== 'account' || !!r.scope.accountId?.trim())
    && validSpatialRadius(r.radiusMeters);
}

/** Deterministic: the caller supplies one clock for the entire evaluation. */
export function validateSpatialEvidence(
  request: SpatialRequest, location: SpatialLocation | null,
  batches: readonly SpatialEvidence[], now: Date,
): SpatialValidation {
  const result: SpatialValidation = {
    version: 'spatial-validation-v1', ok: false, automated: false, requiresOperatorReview: true,
    ...request, location: null, checks: [], evidence: [], nearby: [], counts: {},
    blockers: [], warnings: [], manualControls: [], provenance: [],
  };
  const check = (code: string, pass: boolean) => {
    result.checks.push({ code, status: pass ? 'pass' : 'blocked' });
    if (!pass) result.blockers.push(code);
    return pass;
  };
  const manual = (code: string) => {
    result.checks.push({ code, status: 'manual' });
    result.manualControls.push(code);
  };
  if (!check('request_valid', validSpatialRequest(request) && Number.isFinite(now.getTime()))) return result;
  if (!check('location_scope', !!location && sameSpatialScope(request.scope, location.scope) && location.mode === request.mode)) return result;
  // Never return foreign identity, address or evidence, even on a failed result.
  result.location = location;
  const target = location!;
  check('address_available', typeof target.address === 'string' && !!target.address.trim());
  if (!check('coordinates_valid', validCoordinates(target.coordinates))) return result;
  const center = target.coordinates!;
  const sourceValid = (source: SpatialSource, key: string) => {
    const observed = Date.parse(source.observedAt);
    const valid = !!source.provider?.trim() && source.origin !== 'synthetic'
      && ['external', 'manual'].includes(source.origin)
      && ['live', 'cached', 'manual'].includes(source.delivery)
      && Number.isFinite(observed) && observed <= now.getTime()
      && now.getTime() - observed <= SPATIAL_MAX_AGE_MS;
    check(key, valid);
    if (valid) {
      result.provenance.push(source);
      if (source.origin === 'manual' || source.delivery === 'manual') manual('operator_verified_spatial_evidence');
    }
    return valid;
  };
  sourceValid(target.source, 'location_provenance');
  if (target.addressCoordinates) {
    check('address_coordinates_consistent', validCoordinates(target.addressCoordinates)
      && haversineMeters(center.lat, center.lon, target.addressCoordinates.lat, target.addressCoordinates.lon) <= 250);
  } else manual('confirm_address_and_map_point');
  if (request.purpose === 'site_assessment') {
    check('geography_available', !!target.city?.trim() && !!target.country?.trim());
  }
  const covered = new Set<string>();
  const entities = new Map<string, SpatialValidation['nearby'][number]>();
  for (const batch of batches) {
    if (!sameSpatialScope(request.scope, batch.scope) || batch.mode !== request.mode) {
      check('evidence_scope', false); continue;
    }
    if (!validCoordinates(batch.center) || haversineMeters(center.lat, center.lon, batch.center.lat, batch.center.lon) > 1
      || !validSpatialRadius(batch.radiusMeters) || batch.radiusMeters < request.radiusMeters) {
      check('evidence_radius_scope', false); continue;
    }
    result.evidence.push(batch);
    if (!sourceValid(batch.source, 'evidence_provenance') || batch.status === 'unavailable') {
      check('provider_available', false); continue;
    }
    if (batch.status === 'partial') {
      result.warnings.push('partial_provider_coverage');
      manual('verify_missing_map_coverage');
      // Partial queries cannot prove absence of competitors, even with usable POIs.
    } else if (batch.status === 'available') batch.coverage.forEach(kind => covered.add(kind));
    else { check('provider_status_known', false); continue; }
    for (const entity of batch.entities) {
      if (!validCoordinates(entity.coordinates)) { check('entity_coordinates_valid', false); continue; }
      if (!sourceValid(entity.source, 'entity_provenance')) continue;
      if (!entity.id?.trim() || !entity.category?.trim()) { check('entity_identity', false); continue; }
      const distanceMeters = haversineMeters(center.lat, center.lon, entity.coordinates.lat, entity.coordinates.lon);
      if (distanceMeters > request.radiusMeters) continue;
      const key = entity.source.provider + ':' + entity.id + ':' + entity.kind;
      const existing = entities.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify({ ...entity, distanceMeters })) {
        check('conflicting_entity_evidence', false); continue;
      }
      entities.set(key, { ...entity, distanceMeters });
    }
  }
  result.nearby = [...entities.values()].sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  check('nearby_evidence_available', result.nearby.length > 0);
  if (request.mode === 'commercial' && request.purpose === 'site_assessment') {
    check('commercial_competitor_coverage', covered.has('competitor'));
    check('commercial_demand_evidence', result.nearby.some(e => ['demand_anchor', 'transit', 'attraction'].includes(e.kind)));
    manual('verify_pedestrian_barriers_and_actual_footfall');
  }
  for (const entity of result.nearby) result.counts[entity.kind] = (result.counts[entity.kind] ?? 0) + 1;
  // Absence remains unknown unless a successful scoped survey actually covered that entity kind.
  if (covered.has('competitor') && !result.counts.competitor) result.counts.competitor = 0;
  result.blockers = [...new Set(result.blockers)];
  result.warnings = [...new Set(result.warnings)];
  result.manualControls = [...new Set(result.manualControls)];
  result.provenance = [...new Map(result.provenance.map(p => [JSON.stringify(p), p])).values()];
  result.ok = result.blockers.length === 0;
  result.requiresOperatorReview = !result.ok || result.manualControls.length > 0;
  result.automated = result.ok && !result.requiresOperatorReview;
  return result;
}

export type SpatialValidationDependencies = {
  /** Server-owned resolver. Never derive account ownership from guest/browser metadata. */
  resolveLocation(request: SpatialRequest): Promise<SpatialLocation | null>;
  loadEvidence(location: SpatialLocation, request: SpatialRequest): Promise<SpatialEvidence[]>;
};
/** Shared runner, no persistence/global cache and no implicit provider/mock fallback. */
export async function validateLocation(request: SpatialRequest, deps: SpatialValidationDependencies, now: Date): Promise<SpatialValidation> {
  let location: SpatialLocation | null = null;
  try {
    if (!validSpatialRequest(request)) return validateSpatialEvidence(request, null, [], now);
    location = await deps.resolveLocation(request);
    if (!location || !sameSpatialScope(request.scope, location.scope) || location.mode !== request.mode || !validCoordinates(location.coordinates)) {
      return validateSpatialEvidence(request, location, [], now);
    }
    const evidence = await deps.loadEvidence(location, request);
    // Re-resolve after the awaited provider: no stale ownership/coordinates may release evidence.
    const latest = await deps.resolveLocation(request);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(location)) {
      return { ...validateSpatialEvidence(request, null, [], now), blockers: ['location_changed_during_validation'] };
    }
    return validateSpatialEvidence(request, location, evidence, now);
  } catch {
    const result = validateSpatialEvidence(request, null, [], now);
    return { ...result, blockers: ['spatial_dependency_unavailable'] };
  }
}
