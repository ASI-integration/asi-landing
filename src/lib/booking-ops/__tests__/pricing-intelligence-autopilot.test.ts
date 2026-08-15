import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; remove?: boolean } = {}) { this.filtered = [...rows(table)]; }
  eq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filtered = this.filtered.filter((row) => values.includes(row[column])); return this; }
  gte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value)); return this; }
  lte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value)); return this; }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select() { return this; }
  private execute() {
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    if (this.options.remove) for (const row of this.filtered) rows(this.table).splice(rows(this.table).indexOf(row), 1);
    return { data: this.options.remove ? null : this.filtered, error: null };
  }
  async single() { const result = this.execute(); return { data: result.data?.[0] ?? null, error: result.data?.[0] ? null : { message: 'not found' } }; }
  async maybeSingle() { const result = this.execute(); return { data: result.data?.[0] ?? null, error: null }; }
  then(resolve: (value: ReturnType<Query['execute']>) => void) { resolve(this.execute()); }
}

vi.mock('../communication-auto-send-policy', () => ({
  canAutoSendCommunicationIntent: vi.fn().mockResolvedValue({ eligible: false, reason: 'global_off' }),
  attachAutoSendDecisionMetadata: (metadata: Row, decision: unknown) => ({ ...metadata, auto_send_decision: decision }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => new Query(table)),
      insert: vi.fn((input: Row | Row[]) => {
        const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }));
        rows(table).push(...inserted);
        const query = new Query(table);
        (query as any).filtered = inserted;
        return query;
      }),
      upsert: vi.fn((input: Row | Row[], options?: { onConflict?: string }) => {
        const incoming = Array.isArray(input) ? input : [input];
        const keys = (options?.onConflict?.split(',') ?? ['id']).map((k) => k.trim());
        const affected: Row[] = [];
        for (const candidate of incoming) {
          const existing = rows(table).find((row) => keys.every((key) => row[key] === candidate[key]));
          if (existing) { Object.assign(existing, candidate); affected.push(existing); }
          else { const stored = { ...candidate }; rows(table).push(stored); affected.push(stored); }
        }
        const query = new Query(table);
        (query as any).filtered = affected;
        return query;
      }),
      update: vi.fn((patch: Row) => new Query(table, { patch })),
      delete: vi.fn(() => new Query(table, { remove: true })),
    })),
  },
}));

import {
  assertAllowedRadius,
  buildPricingSnapshotForPublicationPackage,
  generateTariffGrid,
  getPricingReadiness,
  initializePricingProfile,
  ingestMarketSignals,
  markPricingAutoApplyEnabledPlaceholder,
  recommendPriceForDate,
  runPricingRecommendation,
  updatePricingGuardrails,
  validateManualMarketSnapshot,
} from '../pricing-intelligence-autopilot';
import { inferPropertyAudience, getAudiencePricingWeights } from '../property-audience-intelligence';
import {
  computeMarketPressureScore,
  getAudienceRadiusWeights,
  ingestManualMarketSnapshot,
  validateMarketSnapshot,
} from '../market-signals-ingestion';
import { buildPublicationPackage, initializePublicationPackage, selectPublicationChannels } from '../channel-publishing-preparation';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const SETUP_ID = '20000000-0000-4000-8000-000000000002';
const CONNECTION_ID = '30000000-0000-4000-8000-000000000003';
const NOW = '2026-07-01T12:00:00.000Z';

function seedSetup(overrides: Row = {}) {
  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push({
    id: SETUP_ID,
    owner_setup_id: OWNER_ID,
    property_id: 'prop-a',
    title: 'Квартира у моря',
    address_city: 'Сочи',
    address_area: 'Адлер',
    address_safe_summary: 'Курорт у моря, пляж рядом',
    property_type: 'Квартира',
    room_count: 2,
    guest_capacity: 4,
    checkin_time: '15:00',
    checkout_time: '12:00',
    rules_status: 'complete',
    photos_status: 'enough',
    pricing_status: 'ready',
    metadata: { base_price_label: 'от 5 000 ₽ за ночь', amenities: ['Wi-Fi', 'Кухня'] },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
  rows('booking_channel_manager_connections').push({
    id: CONNECTION_ID,
    property_setup_id: SETUP_ID,
    provider: 'bnovo',
    status: 'import_ready',
    access_status: 'received',
    created_at: NOW,
    updated_at: NOW,
  });
  for (let i = 1; i <= 3; i += 1) {
    rows('booking_property_assets').push({
      id: `40000000-0000-4000-8000-00000000000${i}`,
      property_setup_id: SETUP_ID,
      asset_type: 'photo',
      status: 'accepted',
      storage_ref: `photo-${i}.jpg`,
      safe_label: `Фото ${i}`,
      created_at: NOW,
      updated_at: NOW,
    });
  }
}

beforeEach(() => {
  for (const table of Object.keys(tables)) tables[table] = [];
  seedSetup();
});

describe('Pricing Intelligence & Tariff Grid v1', () => {
  it('initializes pricing profile from property setup', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    expect(profile.propertySetupId).toBe(SETUP_ID);
    expect(profile.basePrice).toBe(5000);
    expect(profile.status).toBe('ready_for_recommendations');
    expect(profile.autoApplyIsPlaceholder).toBe(true);
  });

  it('shows incomplete pricing when base/min/max or strategy missing', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    const incomplete = await updatePricingGuardrails(profile.id, { base_price: null, min_price: null, max_price: null });
    expect(incomplete.missingFields).toEqual(expect.arrayContaining(['base_price', 'min_price', 'max_price']));
    expect(incomplete.status).toBe('incomplete');
  });

  it('infers leisure_seaside audience for seaside object', async () => {
    const audience = await inferPropertyAudience(SETUP_ID);
    expect(audience.primaryAudience).toBe('leisure_seaside');
    expect(audience.confidenceScore).toBeGreaterThan(40);
  });

  it('infers business_center audience for business center object', async () => {
    const setup = rows('booking_property_setup_profiles')[0];
    setup.title = 'Апартаменты в деловом центре';
    setup.address_city = 'Москва';
    setup.address_safe_summary = 'Деловой центр, рядом офисы';
    setup.address_area = 'ЦАО';
    setup.property_type = 'Апартаменты';
    setup.guest_capacity = 2;
    setup.metadata = { amenities: ['Конференц-зал'] };
    const audience = await inferPropertyAudience(SETUP_ID);
    expect(audience.primaryAudience).toBe('business_center');
  });

  it('sets mixed or unknown audience when confidence is low', async () => {
    const setup = rows('booking_property_setup_profiles')[0];
    setup.address_city = '';
    setup.address_safe_summary = '';
    setup.address_area = '';
    setup.property_type = '';
    setup.guest_capacity = 1;
    setup.room_count = 1;
    setup.metadata = { amenities: [] };
    const audience = await inferPropertyAudience(SETUP_ID);
    expect(['mixed', 'unknown']).toContain(audience.primaryAudience);
    expect(audience.confidenceScore).toBeLessThan(40);
  });

  it('ingests market snapshot for 1/3/7/10 km radii', async () => {
    for (const radius of [1, 3, 7, 10]) {
      const signals = await ingestMarketSignals(SETUP_ID, {
        radius_km: radius,
        date: '2026-07-10',
        competitor_prices: { median: 4500, count: 20 },
      });
      expect(signals[0].radiusKm).toBe(radius);
    }
    expect(rows('booking_pricing_market_signals')).toHaveLength(4);
  });

  it('rejects invalid radius', () => {
    expect(() => assertAllowedRadius(5)).toThrow(/1, 3, 7 или 10/);
    expect(() => validateManualMarketSnapshot({ radius_km: 2, date: '2026-07-10' })).toThrow();
  });

  it('rejects unsafe market payloads and invalid counts', () => {
    expect(() => validateMarketSnapshot({ radius_km: 3, date: '2026-07-10', competitor_prices: { count: -1 } })).toThrow(/конкурентов/iu);
    expect(() => validateMarketSnapshot({ radius_km: 3, date: '2026-07-10', available_supply: { available_count: 8, total_count: 4 } })).toThrow(/меньше доступного/iu);
    expect(() => validateMarketSnapshot({ radius_km: 3, date: '2026-07-10', events: [{ name: '<script>alert(1)</script>' }] })).toThrow(/недопустимые/iu);
  });

  it('combined manual snapshot records all normalized signal types and ingestion run', async () => {
    const result = await ingestManualMarketSnapshot(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-10',
      competitor_prices: { median: 4500, p25: 3800, p75: 6200, count: 42 },
      available_supply: { available_count: 18, total_count: 57 },
      events: [{ name: 'Концерт', date: '2026-07-10', distance_km: 2.4, expected_impact: 'high' }],
      weather: { date: '2026-07-10', condition: 'дождь', precipitation_probability: 0.7, impact: 'medium_negative' },
    });
    expect(result.signals.map((signal) => signal.signalType).sort()).toEqual(['available_supply', 'competitor_prices', 'event_pressure', 'weather_pressure']);
    expect(rows('booking_market_signal_ingestion_runs')).toHaveLength(1);
    expect(rows('booking_market_signal_ingestion_runs')[0].status).toBe('completed');
  });

  it('audience-specific radius weights prioritize the intended areas', () => {
    const business = getAudienceRadiusWeights('business_center', 'competitor_prices');
    const seasideWeather = getAudienceRadiusWeights('leisure_seaside', 'weather_pressure');
    const eventVisitors = getAudienceRadiusWeights('event_visitors', 'event_pressure');
    expect(business[1]).toBeGreaterThan(business[7]);
    expect(business[3]).toBeGreaterThan(business[10]);
    expect(seasideWeather[7]).toBeGreaterThan(seasideWeather[1]);
    expect(seasideWeather[10]).toBeGreaterThan(1);
    expect(eventVisitors[1]).toBeGreaterThan(1);
    expect(eventVisitors[10]).toBeGreaterThan(1);
  });

  it('market pressure uses competitor, supply, events and weather signals', async () => {
    await ingestManualMarketSnapshot(SETUP_ID, {
      radius_km: 3, date: '2026-07-10', competitor_prices: { median: 7000, count: 30 },
      available_supply: { available_count: 5, total_count: 50 },
      events: [{ name: 'Форум', expected_impact: 'high' }],
      weather: { condition: 'ясно', impact: 'positive' },
    });
    const pressure = await computeMarketPressureScore(SETUP_ID, '2026-07-10', { audience: 'event_visitors' });
    expect(Object.keys(pressure.components)).toEqual(expect.arrayContaining(['competitor_prices', 'available_supply', 'event_pressure', 'weather_pressure']));
    expect(pressure.signalsUsed).toHaveLength(4);
  });

  it('competitor prices affect recommendation', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await updatePricingGuardrails(profile.id, { base_price: 5000, min_price: 3000, max_price: 10000 });
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-10',
      competitor_prices: { median: 8000, count: 30 },
    });
    const { recommendedPrice, reasons } = await recommendPriceForDate(profile.id, '2026-07-10');
    expect(recommendedPrice).toBeGreaterThan(5000);
    expect(reasons.some((r) => r.factor === 'competitor')).toBe(true);
  });

  it('available supply affects recommendation', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-11',
      available_supply: { available_count: 5, total_count: 50, availability_ratio: 0.1 },
    });
    const { reasons } = await recommendPriceForDate(profile.id, '2026-07-11');
    expect(reasons.some((r) => r.factor === 'supply' && r.direction === 'up')).toBe(true);
  });

  it('event pressure affects recommendation', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-12',
      events: [{ name: 'Концерт', distance_km: 2.4, expected_impact: 'high' }],
    });
    const { reasons } = await recommendPriceForDate(profile.id, '2026-07-12');
    expect(reasons.some((r) => r.factor === 'events' && r.direction === 'up')).toBe(true);
  });

  it('weather pressure affects recommendation', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-13',
      weather: { condition: 'rain', temperature_c: 21, impact: 'medium_negative' },
    });
    const audience = await inferPropertyAudience(SETUP_ID);
    const weights = getAudiencePricingWeights(audience);
    const { reasons } = await recommendPriceForDate(profile.id, '2026-07-13', { audienceProfile: audience });
    expect(weights.weatherWeight).toBeGreaterThan(1);
    expect(reasons.some((r) => r.factor === 'weather')).toBe(true);
  });

  it('audience weights affect recommendation', async () => {
    const seaside = await inferPropertyAudience(SETUP_ID);
    const businessSetup = rows('booking_property_setup_profiles')[0];
    businessSetup.address_city = 'Москва';
    businessSetup.address_safe_summary = 'Деловой центр';
    const business = await inferPropertyAudience(SETUP_ID);
    const seasideWeights = getAudiencePricingWeights(seaside);
    const businessWeights = getAudiencePricingWeights(business);
    expect(seasideWeights.weatherWeight).toBeGreaterThan(businessWeights.weatherWeight);
  });

  it('min/max guardrails constrain price', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await updatePricingGuardrails(profile.id, { base_price: 5000, min_price: 4500, max_price: 5500 });
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-07-14',
      competitor_prices: { median: 12000, count: 50 },
      events: [{ name: 'Фестиваль', expected_impact: 'high' }],
    });
    const { recommendedPrice, reasons } = await recommendPriceForDate(profile.id, '2026-07-14');
    expect(recommendedPrice).toBeLessThanOrEqual(5500);
    expect(recommendedPrice).toBeGreaterThanOrEqual(4500);
    expect(reasons.some((r) => r.factor === 'guardrails')).toBe(true);
  });

  it('produces the synthetic Apartment 101 Saturday shadow demo through the real engine', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await updatePricingGuardrails(profile.id, { base_price: 6000, min_price: 4500, max_price: 6500 });
    await ingestMarketSignals(SETUP_ID, {
      radius_km: 3,
      date: '2026-08-22',
      available_supply: { available_count: 5, total_count: 50, availability_ratio: 0.1 },
      events: [{ name: 'SYNTHETIC DEMO EVENT ONLY', distance_km: 2, expected_impact: 'high' }],
    }, { synthetic_demo_only: true });
    const result = await recommendPriceForDate(profile.id, '2026-08-22');
    expect(result.recommendedPrice).toBe(6500);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ factor: 'day_of_week', direction: 'up' }),
      expect.objectContaining({ factor: 'events', direction: 'up' }),
      expect.objectContaining({ factor: 'guardrails' }),
    ]));
  });

  it('generates tariff grid for 30/60/90 days', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    for (const days of [30, 60, 90]) {
      const end = new Date('2026-07-01');
      end.setDate(end.getDate() + days - 1);
      const grid = await generateTariffGrid(profile.id, '2026-07-01', end.toISOString().slice(0, 10));
      expect(grid).toHaveLength(days);
      expect(grid[0].adjustmentReason.length).toBeGreaterThan(0);
    }
  });

  it('recommendation includes adjustment_reason', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    const run = await runPricingRecommendation(profile.id, '2026-07-01', '2026-07-30');
    expect(run.status).toMatch(/completed/);
    const grid = rows('booking_tariff_grid_days');
    expect(grid.length).toBeGreaterThan(0);
    expect(grid[0].adjustment_reason.length).toBeGreaterThan(0);
  });

  it('missing signals create warnings while a recommendation still completes', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    const run = await runPricingRecommendation(profile.id, '2026-07-01', '2026-07-02', { dryRun: true });
    expect(run.status).toBe('dry_run');
    expect(run.warnings.some((warning) => warning.includes('Нет сигнала'))).toBe(true);
    expect(run.errors).toEqual([]);
  });

  it('recommendation run records normalized signals_used', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await ingestManualMarketSnapshot(SETUP_ID, { radius_km: 7, date: '2026-07-10', competitor_prices: { median: 6000, count: 20 } });
    const run = await runPricingRecommendation(profile.id, '2026-07-10', '2026-07-10', { dryRun: true });
    expect(run.signalsUsed).toContain('competitor_prices');
  });

  it('publication package sees pricing incomplete/ready', async () => {
    const snapshot = await buildPricingSnapshotForPublicationPackage(SETUP_ID);
    expect(snapshot.pricing_status).toBe('missing');
    expect(snapshot.auto_apply_is_placeholder).toBe(true);

    await initializePricingProfile(SETUP_ID);
    const ready = await buildPricingSnapshotForPublicationPackage(SETUP_ID);
    expect(ready.pricing_readiness_score).toBeGreaterThan(0);
  });

  it('auto_apply_enabled_placeholder does not push OTA', async () => {
    const profile = await initializePricingProfile(SETUP_ID);
    await runPricingRecommendation(profile.id, '2026-07-01', '2026-07-07');
    const { markPricingRecommendationsReady, markPricingAutoApplyReady } = await import('../pricing-intelligence-autopilot');
    await markPricingRecommendationsReady(profile.id);
    await markPricingAutoApplyReady(profile.id);
    const enabled = await markPricingAutoApplyEnabledPlaceholder(profile.id);
    expect(enabled.status).toBe('auto_apply_enabled');
    expect(enabled.autoApplyIsPlaceholder).toBe(true);
    expect(enabled.metadata.honest_notice).toMatch(/не live/i);
  });

  it('publication package pricing check uses pricing intelligence', async () => {
    await initializePricingProfile(SETUP_ID);
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok']);
    const pkg = await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    expect(pkg.packagePayload.pricing_intelligence).toBeDefined();
    expect((pkg.packagePayload.pricing_intelligence as Row).auto_apply_is_placeholder).toBe(true);
  });
});

describe('pricing dashboard API auth', () => {
  it('returns 401 for protected pricing endpoints when unauthenticated', async () => {
    vi.doMock('@/lib/crm/api-auth', () => ({
      requireCrmOperatorSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
      requireOpsAdminSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
    }));
    const [profilesRoute, actionRoute, gridRoute, audienceRoute, ingestRoute] = await Promise.all([
      import('@/app/api/dashboard/pricing/profiles/route'),
      import('@/app/api/dashboard/pricing/action/route'),
      import('@/app/api/dashboard/pricing/tariff-grid/route'),
      import('@/app/api/dashboard/pricing/audience/route'),
      import('@/app/api/dashboard/pricing/signals/ingest/route'),
    ]);
    const responses = await Promise.all([
      profilesRoute.GET(new Request('http://localhost/api/dashboard/pricing/profiles')),
      actionRoute.POST(new Request('http://localhost/api/dashboard/pricing/action', { method: 'POST', body: '{}' })),
      gridRoute.GET(new Request('http://localhost/api/dashboard/pricing/tariff-grid')),
      audienceRoute.GET(new Request('http://localhost/api/dashboard/pricing/audience')),
      ingestRoute.POST(new Request('http://localhost/api/dashboard/pricing/signals/ingest', { method: 'POST', body: '{}' })),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
  });

  it('returns 401 for all market signal endpoints when unauthenticated', async () => {
    vi.doMock('@/lib/crm/api-auth', () => ({
      requireOpsAdminSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
    }));
    const [signals, action, ingest, coverage, explain] = await Promise.all([
      import('@/app/api/dashboard/pricing/market-signals/route'),
      import('@/app/api/dashboard/pricing/market-signals/action/route'),
      import('@/app/api/dashboard/pricing/market-signals/ingest/route'),
      import('@/app/api/dashboard/pricing/market-signals/coverage/route'),
      import('@/app/api/dashboard/pricing/market-signals/explain/route'),
    ]);
    const responses = await Promise.all([
      signals.GET(new Request('http://localhost/api/dashboard/pricing/market-signals')),
      action.POST(new Request('http://localhost/api/dashboard/pricing/market-signals/action', { method: 'POST', body: '{}' })),
      ingest.POST(new Request('http://localhost/api/dashboard/pricing/market-signals/ingest', { method: 'POST', body: '{}' })),
      coverage.GET(new Request('http://localhost/api/dashboard/pricing/market-signals/coverage')),
      explain.GET(new Request('http://localhost/api/dashboard/pricing/market-signals/explain')),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
  });
});
