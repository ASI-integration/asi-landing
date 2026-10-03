import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSpatialEvidence } from '../spatial-validation';
import type {
  SpatialEvidence,
  SpatialLocation,
  SpatialRequest,
} from '../spatial-validation-types';

const identity = {
  kind: 'identified' as const,
  accountId: 'account-1',
  propertyId: 'property-1',
  bookingId: 'booking-1',
};
const NOW = Date.parse('2026-10-03T09:00:00.000Z');

type Row = Record<string, unknown>;
const state = {
  property: null as Row | null,
  snapshot: null as Row | null,
};
let snapshotReads = 0;

function scopedValidation(observedAt = new Date(NOW).toISOString()) {
  const scope = { kind: 'account' as const, accountId: 'account-1', locationId: 'property-1' };
  const request: SpatialRequest = {
    scope, mode: 'residential', purpose: 'site_assessment', radiusMeters: 1000,
  };
  const source = {
    provider: 'provider',
    observedAt,
    origin: 'external' as const,
    delivery: 'live' as const,
  };
  const coordinates = { lat: 59.93, lon: 30.36 };
  const location: SpatialLocation = {
    scope,
    mode: 'residential',
    objectKind: 'property',
    address: 'Невский проспект, 1',
    city: 'Санкт-Петербург',
    country: 'RU',
    coordinates,
    addressCoordinates: coordinates,
    source,
  };
  const evidence: SpatialEvidence = {
    scope,
    mode: 'residential',
    center: coordinates,
    radiusMeters: 1000,
    status: 'available',
    coverage: ['poi'],
    source,
    entities: [{
      id: 'node/1', kind: 'poi', category: 'park',
      name: 'Парк', coordinates, source,
    }],
  };
  return validateSpatialEvidence(request, location, [evidence], new Date(NOW));
}
function fakeDb(onSnapshotLoad?: () => void) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            async maybeSingle() {
              if (table === 'properties') {
                return { data: state.property, error: null };
              }
              if (table === 'residential_property_spatial_snapshots') {
                snapshotReads += 1;
                const row = state.snapshot;
                if (columns.includes('validation_json')) onSnapshotLoad?.();
                if (!row) return { data: null, error: null };
                const matches = row.account_id === filters.account_id
                  && row.property_id === filters.property_id;
                return { data: matches ? row : null, error: null };
              }
              return { data: null, error: { message: 'unexpected_table' } };
            },
          };
          return query;
        },
        async upsert(row: Row) {
          if (table !== 'residential_property_spatial_snapshots') {
            return { error: { message: 'unexpected_write' } };
          }
          state.snapshot = { ...row };
          return { error: null };
        },
      };
    },
  };
}

describe('residential property spatial runtime', () => {
  beforeEach(() => {
    snapshotReads = 0;
    state.property = {
      id: 'property-1',
      account_id: 'account-1',
      address_line: 'Невский проспект, 1',
      city: 'Санкт-Петербург',
      country: 'RU',
      updated_at: '2026-10-03T08:00:00.000Z',
    };
    const validation = scopedValidation();
    state.snapshot = {
      account_id: 'account-1',
      property_id: 'property-1',
      revision: 'revision-1',
      observed_at: new Date(NOW).toISOString(),
      validation_json: validation,
    };
  });
  it('reads a stable account/property snapshot without writes', async () => {
    const { readResidentialPropertySpatialSnapshot } = await import('../residential-property-spatial-runtime');
    const snapshot = await readResidentialPropertySpatialSnapshot(identity, {
      db: fakeDb() as never,
      now: () => NOW + 5 * 60_000,
    });

    expect(snapshot).toMatchObject({
      available: true,
      identity,
      observedAt: new Date(NOW).toISOString(),
    });
    expect(snapshot.available && snapshot.value.scope).toEqual({
      kind: 'account', accountId: 'account-1', locationId: 'property-1',
    });
    expect(snapshotReads).toBe(3);
  });

  it('uses spatial 24h freshness instead of the generic 60 second window', async () => {
    const { readResidentialPropertySpatialSnapshot } = await import('../residential-property-spatial-runtime');
    const fresh = await readResidentialPropertySpatialSnapshot(identity, {
      db: fakeDb() as never,
      now: () => NOW + 23 * 60 * 60_000,
    });
    const stale = await readResidentialPropertySpatialSnapshot(identity, {
      db: fakeDb() as never,
      now: () => NOW + 25 * 60 * 60_000,
    });

    expect(fresh.available).toBe(true);
    expect(stale).toEqual({ available: false, reason: 'stale' });
  });
  it('refreshes from canonical property state and forces a fresh OSM provider read', async () => {
    state.snapshot = null;
    const geocode = vi.fn(async () => ({
      result: { lat: 59.93, lon: 30.36, displayName: 'Невский проспект, 1' },
      winner: 'nominatim',
      attempts: [],
    }));
    const fetchOsm = vi.fn(async () => ({
      elements: [{
        type: 'node' as const,
        id: 1,
        lat: 59.9302,
        lon: 30.3602,
        tags: { amenity: 'cafe', name: 'Cafe' },
      }],
      hadProviderFailure: false,
    }));
    const { refreshResidentialPropertySpatialSnapshot } = await import('../residential-property-spatial-runtime');
    const snapshot = await refreshResidentialPropertySpatialSnapshot(identity, {
      db: fakeDb() as never,
      now: () => NOW,
      geocode,
      fetchOsm,
    });

    expect(geocode).toHaveBeenCalledWith(
      'ru', 'Невский проспект, 1, Санкт-Петербург, RU', { maxVariants: 4 },
    );
    expect(fetchOsm).toHaveBeenCalledWith(59.93, 30.36, expect.objectContaining({
      bypassMemoryCache: true,
      allowBackfill: false,
      allowBroadFallback: false,
    }));
    expect(state.snapshot).toMatchObject({
      account_id: 'account-1',
      property_id: 'property-1',
      validation_json: expect.objectContaining({
        version: 'spatial-validation-v1',
        mode: 'residential',
        scope: { kind: 'account', accountId: 'account-1', locationId: 'property-1' },
      }),
    });
    expect(snapshot.available).toBe(true);
  });

  it('does not persist when canonical property location changes during provider awaits', async () => {
    state.snapshot = null;
    const geocode = vi.fn(async () => ({
      result: { lat: 59.93, lon: 30.36 },
      winner: 'nominatim',
      attempts: [],
    }));
    const fetchOsm = vi.fn(async () => {
      state.property = { ...state.property!, updated_at: '2026-10-03T08:01:00.000Z' };
      return { elements: [], hadProviderFailure: false };
    });
    const { refreshResidentialPropertySpatialSnapshot } = await import('../residential-property-spatial-runtime');

    await expect(refreshResidentialPropertySpatialSnapshot(identity, {
      db: fakeDb() as never,
      now: () => NOW,
      geocode,
      fetchOsm,
    })).rejects.toThrow('property_location_changed');
    expect(state.snapshot).toBeNull();
  });
});
