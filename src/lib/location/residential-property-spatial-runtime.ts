import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { geocodePlainAddressForMarket } from './address-providers/geocode-pipeline';
import { fetchOsmData, type OsmFetchResult } from './overpass';
import { osmSpatialEvidence } from './spatial-validation-osm';
import {
  SPATIAL_MAX_AGE_MS,
  sameSpatialScope,
  validCoordinates,
  validateSpatialEvidence,
} from './spatial-validation';
import type {
  SpatialLocation,
  SpatialRequest,
  SpatialValidation,
} from './spatial-validation-types';
import {
  readStableSnapshot,
  type CanonicalVersion,
  type IdentifiedScope,
  type ScopedSnapshot,
} from '../platform/snapshot';
import { validIdentity } from '../platform/decision';

type Db = typeof supabase;
type Row = Record<string, unknown>;
type CanonicalPropertyLocation = {
  id: string;
  accountId: string;
  addressLine: string;
  city: string;
  country: 'RU';
  updatedAt: string;
};

export type ResidentialSpatialRuntimeDeps = {
  db?: Db;
  now?: () => number;
  geocode?: typeof geocodePlainAddressForMarket;
  fetchOsm?: typeof fetchOsmData;
};

const text = (value: unknown): string => String(value ?? '').trim();

function normalizeRuCountry(value: unknown): 'RU' | null {
  const raw = text(value).toLowerCase();
  return ['ru', 'russia', 'россия', 'российская федерация'].includes(raw) ? 'RU' : null;
}

function requireIdentity(identity: IdentifiedScope): void {
  if (!validIdentity(identity) || identity.kind !== 'identified') {
    throw new Error('property_location_scope_mismatch');
  }
}

function propertyRevision(value: CanonicalPropertyLocation): string {
  return [
    value.id, value.accountId, value.addressLine,
    value.city, value.country, value.updatedAt,
  ].join('|');
}
async function readCanonicalPropertyLocation(
  identity: IdentifiedScope,
  db: Db,
): Promise<CanonicalPropertyLocation> {
  requireIdentity(identity);
  const { data, error } = await db
    .from('properties')
    .select('id, account_id, address_line, city, country, updated_at')
    .eq('id', identity.propertyId)
    .maybeSingle();

  if (error) throw new Error('property_location_unavailable');
  if (!data) throw new Error('property_location_missing');

  const row = data as unknown as Row;
  const id = text(row.id);
  const accountId = text(row.account_id);
  if (id !== identity.propertyId || accountId !== identity.accountId) {
    throw new Error('property_location_scope_mismatch');
  }

  const addressLine = text(row.address_line);
  const city = text(row.city);
  const country = normalizeRuCountry(row.country);
  const updatedAt = text(row.updated_at);
  if (!addressLine || !city || !country || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('property_location_incomplete');
  }
  return { id, accountId, addressLine, city, country, updatedAt };
}
async function readSnapshotRow(
  identity: IdentifiedScope,
  db: Db,
  columns: string,
): Promise<Row> {
  requireIdentity(identity);
  const { data, error } = await db
    .from('residential_property_spatial_snapshots')
    .select(columns)
    .eq('account_id', identity.accountId)
    .eq('property_id', identity.propertyId)
    .maybeSingle();

  if (error) throw new Error('property_spatial_snapshot_unavailable');
  if (!data) throw new Error('property_spatial_snapshot_missing');
  const row = data as unknown as Row;
  if (text(row.account_id) !== identity.accountId || text(row.property_id) !== identity.propertyId) {
    throw new Error('property_location_scope_mismatch');
  }
  return row;
}

async function readSnapshotVersion(
  identity: IdentifiedScope,
  db: Db,
): Promise<CanonicalVersion> {
  const row = await readSnapshotRow(
    identity,
    db,
    'account_id, property_id, revision, observed_at',
  );
  const revision = text(row.revision);
  const observedAt = text(row.observed_at);
  if (!revision || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error('property_spatial_snapshot_malformed');
  }
  return { identity: { ...identity }, revision, observedAt };
}
async function loadSpatialValidation(
  identity: IdentifiedScope,
  db: Db,
): Promise<SpatialValidation> {
  const row = await readSnapshotRow(
    identity,
    db,
    'account_id, property_id, validation_json',
  );
  if (!row.validation_json || typeof row.validation_json !== 'object') {
    throw new Error('property_spatial_snapshot_malformed');
  }
  return structuredClone(row.validation_json) as SpatialValidation;
}

export async function readResidentialPropertySpatialSnapshot(
  identity: IdentifiedScope,
  deps: Pick<ResidentialSpatialRuntimeDeps, 'db' | 'now'> = {},
): Promise<ScopedSnapshot<SpatialValidation>> {
  const db = deps.db ?? supabase;
  const now = deps.now ?? Date.now;
  return readStableSnapshot(identity, {
    readVersion: (scope) => readSnapshotVersion(scope, db),
    load: (scope) => loadSpatialValidation(scope, db),
    now,
    maxAgeMs: SPATIAL_MAX_AGE_MS,
  });
}

function oldestObservedAt(validation: SpatialValidation): string {
  const values = validation.provenance
    .map((source) => source.observedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return values[0] ?? new Date(0).toISOString();
}
async function persistSpatialValidation(
  identity: IdentifiedScope,
  validation: SpatialValidation,
  db: Db,
): Promise<void> {
  const expectedScope = {
    kind: 'account' as const,
    accountId: identity.accountId,
    locationId: identity.propertyId,
  };
  if (!sameSpatialScope(validation.scope, expectedScope)) {
    throw new Error('property_location_scope_mismatch');
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from('residential_property_spatial_snapshots')
    .upsert({
      account_id: identity.accountId,
      property_id: identity.propertyId,
      revision: randomUUID(),
      observed_at: oldestObservedAt(validation),
      validation_json: validation,
      updated_at: now,
    }, { onConflict: 'account_id,property_id' });
  if (error) throw new Error('property_spatial_snapshot_write_failed');
}

function propertyAddress(value: CanonicalPropertyLocation): string {
  return [value.addressLine, value.city, value.country].join(', ');
}
export async function refreshResidentialPropertySpatialSnapshot(
  identity: IdentifiedScope,
  deps: ResidentialSpatialRuntimeDeps = {},
): Promise<ScopedSnapshot<SpatialValidation>> {
  requireIdentity(identity);
  const db = deps.db ?? supabase;
  const now = deps.now ?? Date.now;
  const geocode = deps.geocode ?? geocodePlainAddressForMarket;
  const fetchOsm = deps.fetchOsm ?? fetchOsmData;

  const before = await readCanonicalPropertyLocation(identity, db);
  const geocoded = await geocode('ru', propertyAddress(before), { maxVariants: 4 });
  if (!geocoded.result || !validCoordinates(geocoded.result)) {
    throw new Error('property_geocode_unavailable');
  }
  const geocodeObservedAt = new Date(now()).toISOString();

  let osm: OsmFetchResult;
  try {
    osm = await fetchOsm(geocoded.result.lat, geocoded.result.lon, {
      requestTimeoutMs: 7_000,
      maxEndpointAttempts: 2,
      allowBackfill: false,
      allowBroadFallback: false,
      bypassMemoryCache: true,
    });
  } catch {
    throw new Error('property_spatial_provider_unavailable');
  }
  const evidenceObservedAt = new Date(now()).toISOString();
  const after = await readCanonicalPropertyLocation(identity, db);
  if (propertyRevision(before) !== propertyRevision(after)) {
    throw new Error('property_location_changed');
  }

  const request: SpatialRequest = {
    scope: {
      kind: 'account',
      accountId: identity.accountId,
      locationId: identity.propertyId,
    },
    mode: 'residential',
    purpose: 'site_assessment',
    radiusMeters: 1000,
  };
  const coordinates = {
    lat: geocoded.result.lat,
    lon: geocoded.result.lon,
  };
  const location: SpatialLocation = {
    scope: request.scope,
    mode: 'residential',
    objectKind: 'property',
    address: propertyAddress(after),
    normalizedAddress: geocoded.result.displayName ?? propertyAddress(after),
    city: geocoded.result.locality ?? geocoded.result.settlement ?? after.city,
    region: geocoded.result.adminArea1,
    country: 'RU',
    coordinates,
    source: {
      provider: geocoded.winner ?? 'geocode-provider',
      observedAt: geocodeObservedAt,
      origin: 'external',
      delivery: 'live',
    },
  };
  const evidence = osmSpatialEvidence({
    request,
    location,
    elements: osm.elements,
    observedAt: evidenceObservedAt,
    hadProviderFailure: osm.hadProviderFailure,
    usedFallbackQuery: osm.usedFallbackQuery,
    cached: false,
    source: 'osm-overpass',
  });
  const validation = validateSpatialEvidence(
    request,
    location,
    [evidence],
    new Date(now()),
  );

  await persistSpatialValidation(identity, validation, db);
  return readResidentialPropertySpatialSnapshot(identity, { db, now });
}
