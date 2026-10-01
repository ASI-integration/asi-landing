import type { OSMElement } from './types';
import { classifyElement } from './overpass-classify';
import { validateSpatialEvidence } from './spatial-validation';
import type { SpatialEntity, SpatialEvidence, SpatialLocation, SpatialRequest, SpatialSource } from './spatial-validation-types';

/** OSM query recovery is still real data; partial coverage is never a synthetic complete survey. */
export function osmSpatialEvidence(args: {
  request: SpatialRequest; location: SpatialLocation; elements: readonly OSMElement[];
  observedAt: string; hadProviderFailure: boolean; usedFallbackQuery?: boolean;
  cached?: boolean; source?: string;
}): SpatialEvidence {
  const source: SpatialSource = {
    provider: args.source ?? 'osm-overpass', observedAt: args.observedAt,
    origin: /mock|demo|synthetic|sample/i.test(args.source ?? '') ? 'synthetic' : 'external',
    delivery: args.hadProviderFailure ? 'unavailable' : args.cached ? 'cached' : 'live',
  };
  const entities: SpatialEntity[] = [];
  for (const el of args.elements) {
    const coordinates = { lat: el.lat ?? el.center?.lat ?? NaN, lon: el.lon ?? el.center?.lon ?? NaN };
    const classification = classifyElement(el);
    const tags = el.tags ?? {};
    const category = classification?.categoryId ?? tags.shop ?? tags.amenity;
    if (!category) continue;
    const kind = category === 'competitor' ? 'competitor'
      : ['metro', 'railway_station', 'airport', 'strategicTransportHub'].includes(category) ? 'transit'
      : category === 'attraction' ? 'attraction'
      : classification ? 'demand_anchor' : 'poi';
    const evidenceSource = { ...source, reference: 'https://www.openstreetmap.org/' + el.type + '/' + el.id };
    const entity: SpatialEntity = {
      id: el.type + '/' + el.id, kind, category, name: classification?.name ?? tags.name ?? category,
      coordinates, source: evidenceSource,
    };
    entities.push(entity);
    if (['hotel', 'hostel', 'guest_house', 'apartment', 'motel'].includes(tags.tourism ?? '') && kind !== 'competitor') {
      entities.push({ ...entity, kind: 'competitor', category: 'lodging' });
    }
  }
  return {
    scope: args.request.scope, mode: args.request.mode, center: args.location.coordinates!,
    radiusMeters: args.request.radiusMeters,
    // Existing category-dependent Overpass radii do not establish exhaustive business-category coverage.
    status: args.hadProviderFailure ? 'unavailable' : 'partial',
    coverage: [], source, entities,
  };
}

/** Both existing residential/commercial consumers use the same evidence validator. Public points prove no tenancy. */
export function validatePublicOsmLocation(args: {
  mode: SpatialRequest['mode']; lat: number; lon: number; address: string;
  elements?: readonly OSMElement[]; observedAt: string; now: Date;
  hadProviderFailure: boolean; usedFallbackQuery?: boolean; cached?: boolean; source?: string;
  radiusMeters?: number; coordinatesSynthetic?: boolean;
}) {
  const request: SpatialRequest = {
    scope: { kind: 'public', locationId: args.lat + ',' + args.lon },
    mode: args.mode, purpose: 'map_preview', radiusMeters: args.radiusMeters ?? 5000,
  };
  const location: SpatialLocation = {
    scope: request.scope, mode: request.mode, objectKind: 'public_point',
    address: args.address, normalizedAddress: args.address.trim().toLowerCase().replace(/\s+/g, ' '),
    coordinates: { lat: args.lat, lon: args.lon },
    source: { provider: 'requested-map-point', observedAt: args.observedAt,
      origin: args.coordinatesSynthetic ? 'synthetic' : 'manual', delivery: 'manual' },
  };
  const evidence = osmSpatialEvidence({ ...args, request, location, elements: args.elements ?? [] });
  const validation = validateSpatialEvidence(request, location, [evidence], args.now);
  if (!args.elements) {
    validation.ok = false; validation.automated = false; validation.requiresOperatorReview = true;
    validation.blockers.push('raw_evidence_unavailable');
  }
  return validation;
}
