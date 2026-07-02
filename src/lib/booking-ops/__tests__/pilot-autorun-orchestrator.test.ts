import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnerSetupStatus: vi.fn(), getPropertySetupById: vi.fn(), initializeOwnerSetupFromLead: vi.fn(),
  requestMissingPropertySetupData: vi.fn(), requestPropertyPhotos: vi.fn(), validatePropertySetup: vi.fn(),
  getPricingProfileBySetup: vi.fn(), initializePricingProfile: vi.fn(), generateTariffGrid: vi.fn(),
  getAudienceProfile: vi.fn(), inferPropertyAudience: vi.fn(), getMarketSignalBlockers: vi.fn(), initializeMarketSignalSource: vi.fn(),
  getChannelManagerConnectionStatus: vi.fn(), initializeChannelManagerConnection: vi.fn(),
  getPublicationReadinessStatus: vi.fn(), initializePublicationPackage: vi.fn(), buildPublicationPackage: vi.fn(),
  getBookingOpsRecord: vi.fn(), listBookingOpsRecords: vi.fn(), syncBookingOpsTasksForRecordId: vi.fn(),
  initializeBookingOpsCoreLoop: vi.fn(), initializeCheckinExecutionBaseline: vi.fn(), initializeInStayCheckoutBaseline: vi.fn(),
  recomputeBookingCheckinReadiness: vi.fn(), listBookingOpsTasksForRecord: vi.fn(), syncBookingOpsCommunications: vi.fn(),
  marketSources: [] as Array<{ id: string }>, runs: new Map<string, Record<string, unknown>>(),
}));

class Query {
  private operation = 'select'; private payload: Record<string, unknown> = {}; private filters: Record<string, unknown> = {};
  constructor(private table: string) {}
  select() { return this; }
  insert(payload: Record<string, unknown>) { this.operation = 'insert'; this.payload = payload; return this; }
  upsert(payload: Record<string, unknown>) { this.operation = 'upsert'; this.payload = payload; return this; }
  update(payload: Record<string, unknown>) { this.operation = 'update'; this.payload = payload; return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this.resolve(true); }
  single() { return this.resolve(true); }
  then(resolve: (value: unknown) => void) { return this.resolve(false).then(resolve); }
  private async resolve(single: boolean) {
    if (this.table === 'booking_pilot_autorun_runs') {
      if (this.operation === 'insert') mocks.runs.set(String(this.payload.id), { ...this.payload, created_at: this.payload.started_at });
      if (this.operation === 'update') {
        const id = String(this.filters.id); mocks.runs.set(id, { ...mocks.runs.get(id), ...this.payload });
      }
      if (this.operation === 'select') {
        const rows = [...mocks.runs.values()].filter((row) =>
          (!this.filters.scope_type || row.scope_type === this.filters.scope_type)
          && (!this.filters.scope_ref || row.scope_ref === this.filters.scope_ref));
        return { data: single ? rows.at(-1) ?? null : rows, error: null };
      }
    }
    if (this.table === 'booking_market_signal_sources' && this.operation === 'select') return { data: mocks.marketSources, error: null };
    return { data: single ? this.payload : [], error: null };
  }
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => new Query(table) } }));
vi.mock('../owner-object-setup-autopilot', () => ({
  getOwnerSetupStatus: mocks.getOwnerSetupStatus, getPropertySetupById: mocks.getPropertySetupById,
  initializeOwnerSetupFromLead: mocks.initializeOwnerSetupFromLead, requestMissingPropertySetupData: mocks.requestMissingPropertySetupData,
  requestPropertyPhotos: mocks.requestPropertyPhotos, validatePropertySetup: mocks.validatePropertySetup,
}));
vi.mock('../pricing-intelligence-autopilot', () => ({ getPricingProfileBySetup: mocks.getPricingProfileBySetup, initializePricingProfile: mocks.initializePricingProfile, generateTariffGrid: mocks.generateTariffGrid }));
vi.mock('../property-audience-intelligence', () => ({ getAudienceProfile: mocks.getAudienceProfile, inferPropertyAudience: mocks.inferPropertyAudience }));
vi.mock('../market-signals-ingestion', () => ({ getMarketSignalBlockers: mocks.getMarketSignalBlockers, initializeMarketSignalSource: mocks.initializeMarketSignalSource }));
vi.mock('../channel-manager-access-import', () => ({ getChannelManagerConnectionStatus: mocks.getChannelManagerConnectionStatus, initializeChannelManagerConnection: mocks.initializeChannelManagerConnection }));
vi.mock('../channel-publishing-preparation', () => ({ getPublicationReadinessStatus: mocks.getPublicationReadinessStatus, initializePublicationPackage: mocks.initializePublicationPackage, buildPublicationPackage: mocks.buildPublicationPackage }));
vi.mock('../repository', () => ({ getBookingOpsRecord: mocks.getBookingOpsRecord, listBookingOpsRecords: mocks.listBookingOpsRecords, syncBookingOpsTasksForRecordId: mocks.syncBookingOpsTasksForRecordId }));
vi.mock('../core-loop-initialization', () => ({ initializeBookingOpsCoreLoop: mocks.initializeBookingOpsCoreLoop }));
vi.mock('../checkin-execution-autopilot', () => ({ initializeCheckinExecutionBaseline: mocks.initializeCheckinExecutionBaseline }));
vi.mock('../instay-checkout-autopilot', () => ({ initializeInStayCheckoutBaseline: mocks.initializeInStayCheckoutBaseline }));
vi.mock('../pre-checkin-control-center', () => ({ recomputeBookingCheckinReadiness: mocks.recomputeBookingCheckinReadiness }));
vi.mock('../tasks', () => ({ listBookingOpsTasksForRecord: mocks.listBookingOpsTasksForRecord }));
vi.mock('../communication-orchestrator', () => ({ syncBookingOpsCommunications: mocks.syncBookingOpsCommunications }));

import {
  createPilotAutorunFallbackIfNeeded, runPilotAutorunForBooking,
  runPilotAutorunForLead, runPilotAutorunForPropertySetup,
} from '../pilot-autorun-orchestrator';

const completeSetup = {
  id: '11111111-1111-4111-8111-111111111111', ownerSetupId: 'owner-1', propertyId: 'prop-1',
  missingFields: [], photosStatus: 'ready', metadata: { channel_manager_provider: 'manual' },
};
const incompleteSetup = { ...completeSetup, missingFields: ['address', 'photos'], photosStatus: 'missing', metadata: {} };
const pricingReady = { id: 'price-1', basePrice: 5000, minPrice: 3500, maxPrice: 8000, missingFields: [] };
const pricingIncomplete = { id: 'price-1', basePrice: null, minPrice: null, maxPrice: null, missingFields: ['base_price'] };
const publication = { id: 'package-1', status: 'incomplete', missingFields: ['pricing'] };

describe('Pilot autorun orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.runs.clear(); mocks.marketSources.splice(0);
    mocks.getPropertySetupById.mockResolvedValue(completeSetup); mocks.validatePropertySetup.mockResolvedValue(completeSetup);
    mocks.getPricingProfileBySetup.mockResolvedValue(pricingIncomplete); mocks.initializePricingProfile.mockResolvedValue(pricingIncomplete);
    mocks.getAudienceProfile.mockResolvedValue(null); mocks.inferPropertyAudience.mockResolvedValue({ primaryAudience: 'mixed' });
    mocks.getMarketSignalBlockers.mockResolvedValue(['Нет рыночных сигналов.']);
    mocks.getChannelManagerConnectionStatus.mockResolvedValue(null); mocks.initializeChannelManagerConnection.mockResolvedValue({ id: 'connection-1' });
    mocks.getPublicationReadinessStatus.mockResolvedValue(null); mocks.initializePublicationPackage.mockResolvedValue(publication); mocks.buildPublicationPackage.mockResolvedValue(publication);
    mocks.requestMissingPropertySetupData.mockResolvedValue({}); mocks.requestPropertyPhotos.mockResolvedValue({});
    mocks.syncBookingOpsTasksForRecordId.mockResolvedValue({ ok: true }); mocks.listBookingOpsTasksForRecord.mockResolvedValue({ ok: true, tasks: [] });
    mocks.syncBookingOpsCommunications.mockResolvedValue({ ok: true, communications: [], plan: {} });
  });

  it('initializes owner setup from a lead and keeps a real property as the next explicit action', async () => {
    mocks.getOwnerSetupStatus.mockResolvedValueOnce({ ownerSetup: null, propertySetups: [], communications: [] })
      .mockResolvedValueOnce({ ownerSetup: { id: 'owner-1' }, propertySetups: [], communications: [] });
    const result = await runPilotAutorunForLead('lead-1');
    expect(mocks.initializeOwnerSetupFromLead).toHaveBeenCalledOnce();
    expect(result.blockers).toContain('Не выбран реальный тестовый объект.');
  });

  it('detects missing property data, queues safe intents and never fakes publication readiness', async () => {
    mocks.getPropertySetupById.mockResolvedValue(incompleteSetup); mocks.validatePropertySetup.mockResolvedValue(incompleteSetup);
    mocks.getOwnerSetupStatus.mockResolvedValue({ communications: [], propertySetups: [], ownerSetup: { id: 'owner-1' } });
    const result = await runPilotAutorunForPropertySetup(completeSetup.id);
    expect(mocks.requestMissingPropertySetupData).toHaveBeenCalledOnce(); expect(mocks.requestPropertyPhotos).toHaveBeenCalledOnce();
    expect(result.blockers.join(' ')).toContain('address'); expect(result.blockers.join(' ')).toContain('Пакет публикации не готов');
  });

  it('initializes pricing, infers audience and initializes a publication package', async () => {
    await runPilotAutorunForPropertySetup(completeSetup.id);
    expect(mocks.initializePricingProfile).toHaveBeenCalledOnce(); expect(mocks.inferPropertyAudience).toHaveBeenCalledOnce();
    expect(mocks.initializePublicationPackage).toHaveBeenCalledOnce(); expect(mocks.buildPublicationPackage).toHaveBeenCalledOnce();
  });

  it('does not generate a tariff grid without base/min/max guardrails', async () => {
    await runPilotAutorunForPropertySetup(completeSetup.id);
    expect(mocks.generateTariffGrid).not.toHaveBeenCalled();
  });

  it('generates a tariff grid when guardrails and required signals exist', async () => {
    mocks.getPricingProfileBySetup.mockResolvedValue(pricingReady); mocks.initializePricingProfile.mockResolvedValue(pricingReady);
    mocks.getMarketSignalBlockers.mockResolvedValue([]);
    await runPilotAutorunForPropertySetup(completeSetup.id);
    expect(mocks.generateTariffGrid).toHaveBeenCalledOnce();
  });

  it('initializes lifecycle, legal/payment/MVD, check-in, checkout, tasks and safe communications for a booking', async () => {
    mocks.getBookingOpsRecord.mockResolvedValue({ id: 'booking-1', propertyId: 'prop-1', checkInAt: '2026-07-10', checkOutAt: '2026-07-12', isBlocked: false });
    await runPilotAutorunForBooking('booking-1');
    expect(mocks.initializeBookingOpsCoreLoop).toHaveBeenCalledOnce(); expect(mocks.initializeCheckinExecutionBaseline).toHaveBeenCalledOnce();
    expect(mocks.initializeInStayCheckoutBaseline).toHaveBeenCalledOnce(); expect(mocks.syncBookingOpsTasksForRecordId).toHaveBeenCalledOnce();
    expect(mocks.syncBookingOpsCommunications).toHaveBeenCalledOnce();
  });

  it('does not create task records when property or stay dates are absent', async () => {
    mocks.getBookingOpsRecord.mockResolvedValue({ id: 'booking-1', propertyId: null, checkInAt: null, checkOutAt: null, isBlocked: false });
    const result = await runPilotAutorunForBooking('booking-1');
    expect(mocks.syncBookingOpsTasksForRecordId).not.toHaveBeenCalled(); expect(result.blockers.join(' ')).toContain('объект и даты');
  });

  it('is idempotent around existing source, audience, connection and owner communication intents', async () => {
    mocks.marketSources.push({ id: 'source-1' }); mocks.getAudienceProfile.mockResolvedValue({ id: 'audience-1' });
    mocks.getChannelManagerConnectionStatus.mockResolvedValue({ id: 'connection-1' });
    mocks.getPropertySetupById.mockResolvedValue(incompleteSetup); mocks.validatePropertySetup.mockResolvedValue(incompleteSetup);
    mocks.getOwnerSetupStatus.mockResolvedValue({ communications: [{ messageType: 'request_property_missing_data' }, { messageType: 'request_property_photos' }] });
    await runPilotAutorunForPropertySetup(completeSetup.id);
    expect(mocks.initializeMarketSignalSource).not.toHaveBeenCalled(); expect(mocks.inferPropertyAudience).not.toHaveBeenCalled();
    expect(mocks.initializeChannelManagerConnection).not.toHaveBeenCalled(); expect(mocks.requestMissingPropertySetupData).not.toHaveBeenCalled();
  });

  it('dry-run writes only audit and does not invoke persistent module actions', async () => {
    mocks.getPropertySetupById.mockResolvedValue(incompleteSetup); mocks.getOwnerSetupStatus.mockResolvedValue({ communications: [] });
    const result = await runPilotAutorunForPropertySetup(completeSetup.id, { dryRun: true });
    expect(result.status).toBe('dry_run'); expect(mocks.validatePropertySetup).not.toHaveBeenCalled();
    expect(mocks.initializePricingProfile).not.toHaveBeenCalled(); expect(mocks.requestMissingPropertySetupData).not.toHaveBeenCalled();
    expect(mocks.initializePublicationPackage).not.toHaveBeenCalled();
  });

  it('surfaces a real blocker and creates a manual fallback without external actions', async () => {
    const status = await createPilotAutorunFallbackIfNeeded({ scopeType: 'booking', scopeRef: 'missing-booking' }, 'Бронь требует проверки.');
    expect(status.status).toBe('blocked'); expect(status.blockers).toEqual(['Бронь требует проверки.']);
  });
});
