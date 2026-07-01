import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const { canAutoSendCommunicationIntent } = vi.hoisted(() => ({ canAutoSendCommunicationIntent: vi.fn() }));
const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; remove?: boolean } = {}) { this.filtered = [...rows(table)]; }
  eq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filtered = this.filtered.filter((row) => values.includes(row[column])); return this; }
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

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => new Query(table)),
      insert: vi.fn((input: Row | Row[]) => {
        const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row })); rows(table).push(...inserted);
        const query = new Query(table); (query as any).filtered = inserted; return query;
      }),
      update: vi.fn((patch: Row) => new Query(table, { patch })),
      delete: vi.fn(() => new Query(table, { remove: true })),
    })),
  },
}));
vi.mock('../communication-auto-send-policy', () => ({
  canAutoSendCommunicationIntent,
  attachAutoSendDecisionMetadata: (metadata: Row, decision: unknown) => ({ ...metadata, auto_send_decision: decision }),
}));

import {
  assertSafePublicationInput,
  buildPublicationPackage,
  initializePublicationPackage,
  markPublishedPlaceholder,
  markReadyForPublication,
  selectAllSupportedPublicationChannels,
  selectPublicationChannels,
} from '../channel-publishing-preparation';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const SETUP_ID = '20000000-0000-4000-8000-000000000002';
const CONNECTION_ID = '30000000-0000-4000-8000-000000000003';
const NOW = '2026-07-01T12:00:00.000Z';

function seedCompleteSetup() {
  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push({
    id: SETUP_ID, owner_setup_id: OWNER_ID, property_id: 'prop-a', title: 'Лесной дом', address_city: 'Тверь',
    address_safe_summary: 'Тихий район Твери', property_type: 'Дом', room_count: 2, guest_capacity: 4,
    checkin_time: '15:00', checkout_time: '12:00', rules_status: 'complete', photos_status: 'enough', pricing_status: 'ready',
    metadata: { base_price_label: 'от 5 000 ₽ за ночь', rules_text: 'Не курить. Соблюдать тишину.', amenities: ['Кухня', 'Парковка'], wifi_password: 'must-never-be-read' },
    created_at: NOW, updated_at: NOW,
  });
  rows('booking_channel_manager_connections').push({ id: CONNECTION_ID, property_setup_id: SETUP_ID, provider: 'bnovo', status: 'import_ready', access_status: 'received', created_at: NOW, updated_at: NOW });
  for (let index = 1; index <= 3; index += 1) rows('booking_property_assets').push({ id: `40000000-0000-4000-8000-00000000000${index}`, property_setup_id: SETUP_ID, asset_type: 'photo', status: 'accepted', storage_ref: `properties/prop-a/${index}.jpg`, safe_label: `Фото ${index}`, created_at: NOW, updated_at: NOW });
}

beforeEach(() => {
  for (const table of Object.keys(tables)) tables[table] = [];
  seedCompleteSetup();
  canAutoSendCommunicationIntent.mockReset();
  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
});

describe('Channel Publishing Preparation v1', () => {
  it('initializes and builds a complete provider-ready package', async () => {
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok', 'yandex_travel']);
    const pkg = await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    expect(pkg).toMatchObject({ provider: 'bnovo', status: 'ready_for_review', readinessScore: 100, realOtaPublishingEnabled: false });
    expect(pkg.packagePayload.selected_channels).toEqual(['ostrovok', 'yandex_travel']);
  });

  it('shows explicit missing fields for an incomplete setup, including photos and pricing', async () => {
    const setup = rows('booking_property_setup_profiles')[0]; setup.photos_status = 'missing'; setup.pricing_status = 'missing'; setup.metadata.base_price_label = null;
    rows('booking_property_assets').length = 0;
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok']);
    const pkg = await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    expect(pkg.status).toBe('incomplete');
    expect(pkg.missingFields).toEqual(expect.arrayContaining(['photos', 'pricing']));
  });

  it('requires a provider connection and selected channels', async () => {
    rows('booking_channel_manager_connections').length = 0;
    const initial = await initializePublicationPackage(SETUP_ID, 'manual');
    const pkg = await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    expect(pkg.missingFields).toEqual(expect.arrayContaining(['selected_channels', 'provider_connection', 'channel_manager_access']));
  });

  it('selects individual channels and all supported channels', async () => {
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    const selected = await selectPublicationChannels(initial.id, ['sutochno']);
    expect(selected.channels.filter((item) => item.selected).map((item) => item.channelKey)).toEqual(['sutochno']);
    const all = await selectAllSupportedPublicationChannels(initial.id);
    expect(all.channels.filter((item) => item.selected)).toHaveLength(13);
    expect(all.channels.find((item) => item.channelKey === 'other')?.selected).toBe(false);
  });

  it('excludes Wi-Fi passwords, access codes, credentials and guest data from the safe payload', async () => {
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok']);
    const pkg = await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    const serialized = JSON.stringify(pkg.packagePayload);
    expect(serialized).not.toMatch(/wifi_password|must-never-be-read|door_code|credential|guest/i);
    expect(() => assertSafePublicationInput({ nested: { door_code: '1234' } })).toThrow(/не может содержать/i);
  });

  it('keeps ready and published-placeholder states honest', async () => {
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok']);
    const ready = await markReadyForPublication(initial.id);
    expect(ready.status).toBe('ready_for_publication');
    expect(ready.realOtaPublishingEnabled).toBe(false);
    const placeholder = await markPublishedPlaceholder(initial.id);
    expect(placeholder.status).toBe('published_placeholder');
    expect(placeholder.safeSummary).toMatch(/ручн|не подтверждение автоматической/i);
  });

  it('queues policy-checked communication intents without sending them', async () => {
    const initial = await initializePublicationPackage(SETUP_ID, 'bnovo');
    await selectPublicationChannels(initial.id, ['ostrovok']);
    await buildPublicationPackage(SETUP_ID, { packageId: initial.id });
    expect(canAutoSendCommunicationIntent).toHaveBeenCalled();
    expect(rows('booking_owner_setup_communication_intents').map((row) => row.message_type)).toEqual(expect.arrayContaining(['channel_selection_needed_notice', 'publication_package_ready_notice']));
    expect(rows('booking_owner_setup_communication_intents').every((row) => row.status === 'draft_ready')).toBe(true);
  });
});

describe('publication dashboard API auth', () => {
  it('returns 401 for all publication endpoints when unauthenticated', async () => {
    vi.doMock('@/lib/crm/api-auth', () => ({
      requireCrmOperatorSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
      requireOpsAdminSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
    }));
    const [packagesRoute, statusRoute, actionRoute] = await Promise.all([
      import('@/app/api/dashboard/channel-manager/publication/packages/route'),
      import('@/app/api/dashboard/channel-manager/publication/status/route'),
      import('@/app/api/dashboard/channel-manager/publication/action/route'),
    ]);
    const responses = await Promise.all([
      packagesRoute.GET(new Request('http://localhost/api/dashboard/channel-manager/publication/packages')),
      statusRoute.GET(new Request(`http://localhost/api/dashboard/channel-manager/publication/status?packageId=${SETUP_ID}`)),
      actionRoute.POST(new Request('http://localhost/api/dashboard/channel-manager/publication/action', { method: 'POST', body: '{}' })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });
});
