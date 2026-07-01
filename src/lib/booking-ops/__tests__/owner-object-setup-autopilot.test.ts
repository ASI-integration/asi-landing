import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCrmContactById, canAutoSendCommunicationIntent } = vi.hoisted(() => ({
  getCrmContactById: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
}));

type Row = Record<string, unknown>;

const tables = {
  booking_owner_setup_profiles: [] as Row[],
  booking_property_setup_profiles: [] as Row[],
  booking_property_assets: [] as Row[],
  booking_owner_setup_communication_intents: [] as Row[],
};

function tableRows(table: keyof typeof tables): Row[] {
  return tables[table];
}

function makeSelect(table: keyof typeof tables) {
  let result = [...tableRows(table)];
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    is(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    not(column: string, _op: string, value: unknown) {
      result = result.filter((row) => row[column] !== value);
      return query;
    },
    in(column: string, values: unknown[]) {
      result = result.filter((row) => values.includes(row[column]));
      return query;
    },
    order() { return query; },
    limit(count: number) {
      result = result.slice(0, count);
      return query;
    },
    maybeSingle: vi.fn(async () => ({ data: result[0] ?? null, error: null })),
    single: vi.fn(async () => ({ data: result[0] ?? null, error: result[0] ? null : { message: 'not found' } })),
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: keyof typeof tables) => ({
      select: vi.fn(() => makeSelect(table)),
      insert: vi.fn((input: Row | Row[]) => {
        const rows = Array.isArray(input) ? input : [input];
        tableRows(table).push(...rows);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: rows[0], error: null })),
            maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })),
          })),
          then: (resolve: (v: unknown) => void) => resolve({ data: rows[0], error: null }),
        };
      }),
      update: vi.fn((patch: Row) => ({
        eq: vi.fn((column: string, value: unknown) => {
          const row = tableRows(table).find((item) => item[column] === value);
          if (row) Object.assign(row, patch);
          return {
            is: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: row, error: null })),
              })),
            })),
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: row ? null : { message: 'not found' } })),
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
            })),
            then: (resolve: (v: unknown) => void) => resolve({ data: row, error: null }),
          };
        }),
      })),
    })),
  },
}));

vi.mock('@/lib/crm/repository', () => ({ getCrmContactById }));
vi.mock('../communication-auto-send-policy', () => ({
  canAutoSendCommunicationIntent,
  attachAutoSendDecisionMetadata: vi.fn((_meta: Record<string, unknown>, decision: unknown) => ({
    ..._meta,
    auto_send_decision: decision,
  })),
}));

import {
  computePropertySetupReadiness,
  getMissingPropertySetupFields,
} from '../owner-object-setup-display';
import {
  initializeOwnerSetupFromLead,
  startObjectDataCollection,
  type PropertySetupProfile,
  validateOwnerSetupPublicPayload,
} from '../owner-object-setup-autopilot';

function baseProperty(overrides: Partial<PropertySetupProfile> = {}): PropertySetupProfile {
  return {
    id: 'prop-1',
    ownerSetupId: 'owner-1',
    propertyId: null,
    leadId: 'lead-1',
    status: 'collecting_data',
    title: null,
    addressCity: null,
    addressArea: null,
    addressSafeSummary: null,
    propertyType: null,
    roomCount: null,
    guestCapacity: null,
    checkinTime: null,
    checkoutTime: null,
    wifiStatus: 'unknown',
    rulesStatus: 'missing',
    photosStatus: 'missing',
    pricingStatus: 'missing',
    channelAccessStatus: 'not_requested',
    readinessScore: 0,
    missingFields: [],
    metadata: {},
    channelHandoffStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('owner-object-setup-autopilot readiness', () => {
  it('incomplete property setup shows missing fields', () => {
    const missing = getMissingPropertySetupFields(baseProperty());
    expect(missing).toContain('title');
    expect(missing).toContain('photos');
    expect(missing).toContain('pricing');
  });

  it('missing photos keeps readiness incomplete', () => {
    const profile = baseProperty({
      title: 'Квартира',
      addressCity: 'Москва',
      propertyType: 'apartment',
      guestCapacity: 4,
      checkinTime: '15:00',
      checkoutTime: '12:00',
      rulesStatus: 'complete',
      pricingStatus: 'partial',
      channelAccessStatus: 'requested',
      photosStatus: 'missing',
    });
    const result = computePropertySetupReadiness(profile);
    expect(result.missingFields).toContain('photos');
    expect(result.readinessScore).toBeLessThan(100);
    expect(result.status).toBe('incomplete');
  });

  it('missing pricing keeps readiness incomplete', () => {
    const profile = baseProperty({
      title: 'Квартира',
      addressCity: 'Москва',
      propertyType: 'apartment',
      guestCapacity: 4,
      checkinTime: '15:00',
      checkoutTime: '12:00',
      rulesStatus: 'complete',
      photosStatus: 'enough',
      channelAccessStatus: 'requested',
      pricingStatus: 'missing',
    });
    const result = computePropertySetupReadiness(profile);
    expect(result.missingFields).toContain('pricing');
    expect(result.status).not.toBe('ready_for_channel_preparation');
  });

  it('complete minimal property setup reaches ready_for_channel_preparation', () => {
    const profile = baseProperty({
      title: 'Квартира',
      addressCity: 'Москва',
      propertyType: 'apartment',
      guestCapacity: 4,
      checkinTime: '15:00',
      checkoutTime: '12:00',
      rulesStatus: 'complete',
      photosStatus: 'enough',
      pricingStatus: 'partial',
      channelAccessStatus: 'received',
    });
    const result = computePropertySetupReadiness(profile);
    expect(result.missingFields).toHaveLength(0);
    expect(result.readinessScore).toBeGreaterThanOrEqual(85);
    expect(result.status).toBe('ready_for_channel_preparation');
  });

  it('rejects credential payloads', () => {
    expect(validateOwnerSetupPublicPayload({ title: 'Test' })).toBeNull();
  });
});

describe('owner-object-setup-autopilot flows', () => {
  beforeEach(() => {
    Object.values(tables).forEach((rows) => { rows.length = 0; });
    vi.clearAllMocks();
    canAutoSendCommunicationIntent.mockResolvedValue({
      decision: 'review_required',
      allowed: false,
      reason: 'draft',
      rule_key: 'test',
      safe_to_display_summary: 'review',
      actual_send_enabled: false,
      policy_decision_id: null,
    });
    getCrmContactById.mockResolvedValue({
      id: 'lead-abc',
      name: 'Тестовый владелец',
      phone: '+79990000000',
      telegramUsername: null,
      email: null,
      source: 'bragin_group',
      note: '',
      role: 'owner',
      status: 'onboarding',
      communicationStatus: 'no_contact',
      objectsCount: 1,
      city: 'Москва',
      nextStep: null,
      nextActionAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('lead initializes owner setup', async () => {
    const first = await initializeOwnerSetupFromLead('lead-abc');
    expect(first.created).toBe(true);
    expect(first.ownerSetup.leadId).toBe('lead-abc');
    expect(first.ownerSetup.pilotGroup).toBe('bragin');
    expect(tables.booking_owner_setup_communication_intents.length).toBe(1);
  });

  it('duplicate initialization does not create duplicates', async () => {
    await initializeOwnerSetupFromLead('lead-abc');
    const second = await initializeOwnerSetupFromLead('lead-abc');
    expect(second.created).toBe(false);
    expect(tables.booking_owner_setup_profiles).toHaveLength(1);
  });

  it('owner setup starts data collection', async () => {
    const { ownerSetup } = await initializeOwnerSetupFromLead('lead-abc');
    const property = await startObjectDataCollection(ownerSetup.id);
    expect(property.status).toBe('collecting_data');
    expect(property.ownerSetupId).toBe(ownerSetup.id);
  });

  it('missing data request creates communication intent', async () => {
    const { requestMissingPropertySetupData } = await import('../owner-object-setup-autopilot');
    const { ownerSetup } = await initializeOwnerSetupFromLead('lead-abc');
    const property = await startObjectDataCollection(ownerSetup.id);
    const before = tables.booking_owner_setup_communication_intents.length;
    await requestMissingPropertySetupData(property.id);
    expect(tables.booking_owner_setup_communication_intents.length).toBeGreaterThan(before);
  });

  it('no raw credential is stored in communication text', async () => {
    const { markChannelAccessReceived } = await import('../owner-object-setup-autopilot');
    const { ownerSetup } = await initializeOwnerSetupFromLead('lead-abc');
    const property = await startObjectDataCollection(ownerSetup.id);
    await markChannelAccessReceived(property.id, 'ref_operator_123');
    const intent = tables.booking_owner_setup_communication_intents.at(-1);
    expect(String(intent?.message_text)).not.toMatch(/password|пароль/i);
    expect(String(intent?.message_text)).not.toContain('ref_operator_123');
  });
});
