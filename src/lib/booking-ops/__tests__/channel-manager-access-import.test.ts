import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const { processInboundBookingRequest, canAutoSendCommunicationIntent } = vi.hoisted(() => ({
  processInboundBookingRequest: vi.fn(), canAutoSendCommunicationIntent: vi.fn(),
}));
const tables: Record<string, Row[]> = {};

function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean } = {}) { this.filtered = [...rows(table)]; }
  eq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] !== value); return this; }
  gte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value)); return this; }
  lte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value)); return this; }
  lt(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') < String(value)); return this; }
  gt(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') > String(value)); return this; }
  in(column: string, values: unknown[]) { this.filtered = this.filtered.filter((row) => values.includes(row[column])); return this; }
  or() { return this; }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select(_columns = '*', options?: { count?: string; head?: boolean }) { if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head }; return this; }
  private execute() {
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    return { data: this.options.head ? null : this.filtered, error: null, count: this.options.count ? this.filtered.length : null };
  }
  async single() { const result = this.execute(); return { data: result.data?.[0] ?? null, error: result.data?.[0] ? null : { message: 'not found' } }; }
  async maybeSingle() { const result = this.execute(); return { data: result.data?.[0] ?? null, error: null }; }
  then(resolve: (value: ReturnType<Query['execute']>) => void) { resolve(this.execute()); }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn((_columns = '*', options?: { count?: string; head?: boolean }) => new Query(table, { count: Boolean(options?.count), head: options?.head })),
      insert: vi.fn((input: Row | Row[]) => {
        const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row })); rows(table).push(...inserted);
        return new Query(table).eq('id', inserted[0]?.id).select();
      }),
      upsert: vi.fn((input: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        const incoming = Array.isArray(input) ? input : [input]; const affected: Row[] = [];
        for (const candidate of incoming) {
          const keys = options?.onConflict?.split(',') ?? ['id'];
          const existing = rows(table).find((row) => keys.every((key) => row[key] === candidate[key]));
          if (existing) { if (!options?.ignoreDuplicates) Object.assign(existing, candidate); affected.push(existing); }
          else { const stored = { ...candidate }; rows(table).push(stored); affected.push(stored); }
        }
        const query = new Query(table); (query as any).filtered = affected; return query;
      }),
      update: vi.fn((patch: Row) => new Query(table, { patch })),
    })),
  },
}));
vi.mock('../communication-auto-send-policy', () => ({
  canAutoSendCommunicationIntent,
  attachAutoSendDecisionMetadata: (metadata: Row, decision: unknown) => ({ ...metadata, auto_send_decision: decision }),
}));
vi.mock('../real-booking-intake-autopilot', () => ({ processInboundBookingRequest }));

import {
  CHANNEL_PROVIDER_ADAPTERS, completeChannelImportRun, createBookingFromImportedChannelBooking, failChannelImportRun, findSecretPath, getChannelImportConflicts,
  importChannelBookings, importChannelCalendar, importChannelObjects, initializeChannelManagerConnection, markChannelManagerAccessReceived,
  performChannelManagerProviderOnboardingAction, queueChannelManagerCommunication, reconcileImportedBookings, reconcileImportedObjects, registerManualChannelSnapshot,
  requestChannelManagerAccess, startChannelImportRun, updateChannelImportEntity,
} from '../channel-manager-access-import';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const PROPERTY_B_ID = '20000000-0000-4000-8000-000000000004';

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push({
    id: PROPERTY_ID, owner_setup_id: OWNER_ID, property_id: 'prop-a', title: 'Лесной дом', address_city: 'Тверь', guest_capacity: 4,
    channel_access_status: 'not_requested', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  rows('properties').push({ id: 'prop-a', account_id: 'acct-access-import' });
  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockImplementation(async (
    input: Row,
    _source?: string,
    options?: { channelManagerScope?: { accountId: string; propertyId: string } },
  ) => {
    const bookingId = '30000000-0000-4000-8000-000000000003';
    const accountId = options?.channelManagerScope?.accountId ?? 'acct-access-import';
    const propertyId = options?.channelManagerScope?.propertyId ?? String(input.propertyId ?? 'prop-a');
    const existing = rows('booking_ops_records').find((row) => row.id === bookingId);
    if (!existing) {
      rows('booking_ops_records').push({
        id: bookingId,
        account_id: accountId,
        property_id: propertyId,
        booking_id: input.bookingReference ?? input.externalSourceId ?? 'book-2',
      });
    }
    return { bookingId, intakeStatus: 'processed' };
  });
});

describe('Channel Manager Access & Import v1', () => {
  it('initializes one provider connection for a property setup', async () => {
    const first = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const second = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    expect(first.id).toBe(second.id);
    expect(rows('booking_channel_manager_connections')).toHaveLength(1);
  });

  it('requests access and queues a policy-checked communication intent', async () => {
    const connection = await requestChannelManagerAccess(PROPERTY_ID, 'bnovo');
    expect(connection.accessStatus).toBe('requested');
    expect(rows('booking_owner_setup_communication_intents')[0]).toMatchObject({ message_type: 'request_channel_manager_access', status: 'draft_ready' });
    expect(canAutoSendCommunicationIntent).toHaveBeenCalledOnce();
  });

  it('stores only a safe credential reference and rejects raw secrets', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const updated = await markChannelManagerAccessReceived(connection.id, 'vault:cm/prop-a');
    expect(updated.safeAccessRef).toBe('vault:cm/prop-a');
    await expect(markChannelManagerAccessReceived(connection.id, 'token=super-secret-value')).rejects.toThrow(/безопасную ссылку/i);
    expect(findSecretPath({ nested: { api_token: 'x' } })).toBe('payload.nested.api_token');
  });

  it('imports objects, bookings, calendar and pricing from a manual snapshot', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const result = await registerManualChannelSnapshot(connection.id, {
      objects: [{ external_object_id: 'ext-1', title: 'Лесной дом', city: 'Тверь', capacity: 4 }],
      bookings: [{ external_booking_id: 'book-1', external_object_id: 'ext-1', guest_safe_name: 'Анна', checkin_date: '2026-07-10', checkout_date: '2026-07-12' }],
      calendar: [{ external_object_id: 'ext-1', date: '2026-07-10', availability_status: 'booked' }],
      pricing: [{ external_object_id: 'ext-1', date: '2026-07-11', price_amount: 5000, currency: 'RUB' }],
    });
    expect(result.summary).toEqual({ objects: 1, bookings: 1, calendar: 1, prices: 1 });
    expect(rows('booking_channel_imported_objects')[0].match_status).toBe('matched');
    expect(rows('booking_channel_calendar_snapshots')).toHaveLength(2);
    expect(rows('booking_channel_manager_connections')[0].metadata.lastManualSnapshotReceipt).toMatchObject({
      sourceImportRunId: result.run.id,
      rowCounts: { objects: 1, bookings: 1, calendar: 1, pricing: 1 },
    });
    expect(rows('booking_owner_setup_communication_intents').at(-1)?.message_type).toBe('channel_import_needs_review_notice');
  });

  it('fails closed before object upsert if the connection moves to another property', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    rows('booking_property_setup_profiles').push({
      id: PROPERTY_B_ID, owner_setup_id: OWNER_ID, property_id: 'prop-b',
      title: 'Другой дом', address_city: 'Псков', guest_capacity: 2,
    });
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    let reads = 0;
    Object.defineProperty(connectionRow, 'property_setup_id', {
      configurable: true,
      get: () => (reads++ === 0 ? PROPERTY_ID : PROPERTY_B_ID),
    });

    await expect(importChannelObjects(connection.id, [
      { external_object_id: 'drift-object', title: 'Лесной дом' },
    ])).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(rows('booking_channel_imported_objects')).toHaveLength(0);
  });

  it('fails closed before booking upsert if the connection account changes', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    let reads = 0;
    Object.defineProperty(connectionRow, 'metadata', {
      configurable: true,
      get: () => ({ accountId: reads++ === 0 ? 'acct-access-import' : 'acct-other' }),
    });

    await expect(importChannelBookings(connection.id, [
      { external_booking_id: 'drift-booking' },
    ])).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(rows('booking_channel_imported_bookings')).toHaveLength(0);
  });

  it('fails closed before calendar upsert if the connection moves to another property', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    rows('booking_property_setup_profiles').push({
      id: PROPERTY_B_ID, owner_setup_id: OWNER_ID, property_id: 'prop-b',
      title: 'Другой дом', address_city: 'Псков', guest_capacity: 2,
    });
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    let reads = 0;
    Object.defineProperty(connectionRow, 'property_setup_id', {
      configurable: true,
      get: () => (reads++ === 0 ? PROPERTY_ID : PROPERTY_B_ID),
    });

    await expect(importChannelCalendar(connection.id, [
      { external_object_id: 'drift-object', date: '2026-11-10', availability_status: 'booked' },
    ])).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(rows('booking_channel_calendar_snapshots')).toHaveLength(0);
  });

  it('marks a title and city only match as possible_match', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await importChannelObjects(connection.id, [{ external_object_id: 'ext-low', title: 'Лесной дом', city: 'Тверь' }]);
    const result = await reconcileImportedObjects(connection.id);
    expect(result.possible).toBe(1);
  });

  it('surfaces object, booking and price conflicts', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await registerManualChannelSnapshot(connection.id, {
      objects: [{ external_object_id: 'unknown', title: 'Другой объект', city: 'Омск' }],
      bookings: [{ external_booking_id: 'unknown-booking' }],
      calendar: [{ external_object_id: 'unknown', date: '2026-08-01', availability_status: 'available' }],
    });
    const conflicts = await getChannelImportConflicts(connection.id);
    expect(conflicts.map((item) => item.type)).toEqual(expect.arrayContaining(['object_not_confirmed', 'booking_missing_in_asi', 'price_missing']));
  });

  it('sends an imported booking through the existing intake and remains idempotent', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    await registerManualChannelSnapshot(connection.id, { bookings: [{ external_booking_id: 'book-2' }] });
    const imported = rows('booking_channel_imported_bookings')[0];
    const first = await createBookingFromImportedChannelBooking(imported.id, {
      accountId: 'acct-access-import',
      propertyId: 'prop-a',
    });
    const second = await createBookingFromImportedChannelBooking(imported.id, {
      accountId: 'acct-access-import',
      propertyId: 'prop-a',
    });
    expect(first.created).toBe(true); expect(second.duplicate).toBe(true);
    expect(processInboundBookingRequest).toHaveBeenCalledOnce();
    expect(processInboundBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingReference: 'book-2',
        externalSourceId: 'book-2',
      }),
      'channel_manager_placeholder',
      expect.objectContaining({
        channelManagerScope: expect.objectContaining({
          connectionId: connection.id,
          accountId: 'acct-access-import',
          propertyId: 'prop-a',
        }),
      }),
    );
  });

  it('fails safely for placeholder providers without real API support', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'travelline');
    expect(CHANNEL_PROVIDER_ADAPTERS.travelline.supports_real_api).toBe(false);
    await expect(startChannelImportRun(connection.id, 'full', { executeProvider: true })).rejects.toThrow(/не подключён/i);
  });

  it('captures canonical connection scope on import runs', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const run = await startChannelImportRun(connection.id, 'manual_snapshot');

    expect(run.metadata.canonicalConnectionScope).toMatchObject({
      connectionId: connection.id,
      ownerSetupId: OWNER_ID,
      propertySetupId: PROPERTY_ID,
      propertyId: 'prop-a',
      accountId: 'acct-access-import',
    });
  });

  it('fails closed when completing a run after the connection moves properties', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const run = await startChannelImportRun(connection.id, 'manual_snapshot');
    rows('booking_property_setup_profiles').push({
      id: PROPERTY_B_ID, owner_setup_id: OWNER_ID, property_id: 'prop-b',
      title: 'Другой дом', address_city: 'Псков', guest_capacity: 2,
    });
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    connectionRow.property_setup_id = PROPERTY_B_ID;

    await expect(completeChannelImportRun(run.id, { objects: 1 })).rejects.toMatchObject({
      code: 'account_scope_mismatch',
    });

    expect(rows('booking_channel_import_runs').find((row) => row.id === run.id)?.status).toBe('running');
  });

  it('fails closed when failing a run after the connection account changes', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const run = await startChannelImportRun(connection.id, 'manual_snapshot');
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    connectionRow.metadata = { ...connectionRow.metadata, accountId: 'acct-other' };

    await expect(failChannelImportRun(run.id, 'provider timeout')).rejects.toMatchObject({
      code: 'account_scope_mismatch',
    });

    expect(rows('booking_channel_import_runs').find((row) => row.id === run.id)?.status).toBe('running');
  });

  it('does not persist an owner notice if connection scope drifts during policy evaluation', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const connectionRow = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
    canAutoSendCommunicationIntent.mockImplementationOnce(async () => {
      connectionRow.metadata = { ...connectionRow.metadata, accountId: 'acct-other' };
      return { eligible: false, reason: 'global_off' };
    });

    await expect(queueChannelManagerCommunication(
      connection,
      'channel_import_completed_notice',
      'Импорт завершён.',
      {
        connectionId: connection.id,
        ownerSetupId: OWNER_ID,
        propertySetupId: PROPERTY_ID,
        propertyId: 'prop-a',
        accountId: 'acct-access-import',
      },
    )).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(rows('booking_owner_setup_communication_intents')).toHaveLength(0);
  });

  it('selects Bnovo, RealtyCalendar and TravelLine as provider-ready connections', async () => {
    for (const provider of ['bnovo', 'realtycalendar', 'travelline'] as const) {
      const result = await performChannelManagerProviderOnboardingAction({ action: 'select_provider', propertySetupId: PROPERTY_ID, provider });
      expect(result.connection).toMatchObject({ provider, status: 'provider_selected' });
    }
    expect(rows('booking_channel_manager_connections')).toHaveLength(3);
    expect(rows('booking_owner_setup_communication_intents').map((item) => item.message_type)).toEqual([
      'channel_provider_selected_notice', 'channel_provider_selected_notice', 'channel_provider_selected_notice',
    ]);
  });

  it('progresses access safely without enabling a real provider API', async () => {
    const selected = await performChannelManagerProviderOnboardingAction({ action: 'select_provider', propertySetupId: PROPERTY_ID, provider: 'bnovo' });
    const requested = await performChannelManagerProviderOnboardingAction({ action: 'request_access', connectionId: selected.connection.id });
    expect(requested.connection.status).toBe('access_requested');
    const received = await performChannelManagerProviderOnboardingAction({ action: 'mark_access_received', connectionId: selected.connection.id, safeAccessRef: 'operator:confirmed' });
    expect(received.connection).toMatchObject({ status: 'access_received', safeAccessRef: 'operator:confirmed' });
    const completed = await performChannelManagerProviderOnboardingAction({ action: 'mark_connected_placeholder', connectionId: selected.connection.id });
    expect(completed.connection.status).toBe('connected_placeholder');
    expect(completed.connection.metadata.realApiSyncEnabled).toBe(false);
    expect(CHANNEL_PROVIDER_ADAPTERS.bnovo.supports_real_api).toBe(false);
  });

  it('keeps manual snapshot import and reconciliation available for a selected provider', async () => {
    const selected = await performChannelManagerProviderOnboardingAction({ action: 'select_provider', propertySetupId: PROPERTY_ID, provider: 'realtycalendar' });
    const uploaded = await performChannelManagerProviderOnboardingAction({
      action: 'upload_manual_snapshot', connectionId: selected.connection.id,
      snapshot: { objects: [{ external_object_id: 'rc-1', title: 'Лесной дом', city: 'Тверь', capacity: 4 }] },
    });
    expect(uploaded.connection.status).toBe('manual_snapshot_available');
    expect(uploaded.importSummary?.objects).toBe(1);
    const reconciled = await performChannelManagerProviderOnboardingAction({ action: 'run_reconciliation', connectionId: selected.connection.id });
    expect(reconciled.connection.status).toBe('import_ready');
  });

  it('does not reconcile imported objects into another owner scope', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const otherOwnerId = '10000000-0000-4000-8000-000000000099';
    const otherSetupId = '20000000-0000-4000-8000-000000000099';
    rows('booking_property_setup_profiles').push({
      id: otherSetupId, owner_setup_id: otherOwnerId, property_id: 'prop-other',
      title: 'Чужой дом', address_city: 'Москва', guest_capacity: 6,
    });
    await importChannelObjects(connection.id, [{
      external_object_id: 'ext-other', property_setup_id: otherSetupId,
      title: 'Чужой дом', city: 'Москва', capacity: 6,
    }]);

    const result = await reconcileImportedObjects(connection.id);

    expect(result).toMatchObject({ matched: 0, possible: 0, unmatched: 1 });
    expect(rows('booking_channel_imported_objects')[0]).toMatchObject({
      match_status: 'unmatched',
      matched_property_setup_id: null,
      matched_property_id: null,
    });
  });

  it('keeps booking reconciliation inside the canonical property', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    rows('booking_ops_records').push({
      id: '30000000-0000-4000-8000-000000000099',
      booking_id: 'book-cross-property',
      account_id: 'acct-access-import',
      property_id: 'prop-b',
    });
    await importChannelBookings(connection.id, [{
      external_booking_id: 'book-cross-property',
      checkin_date: '2026-11-01',
      checkout_date: '2026-11-03',
    }]);

    const result = await reconcileImportedBookings(connection.id);

    expect(result).toMatchObject({ matched: 0, possibleDuplicates: 0, unmatched: 1 });
    expect(rows('booking_channel_imported_bookings')[0]).toMatchObject({
      match_status: 'unmatched',
      matched_booking_id: null,
    });
  });

  it('rejects imported entity updates through another connection', async () => {
    const connectionA = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const connectionB = await initializeChannelManagerConnection(PROPERTY_ID, 'bnovo');
    await importChannelObjects(connectionA.id, [{ external_object_id: 'ext-guarded', title: 'Лесной дом' }]);
    const imported = rows('booking_channel_imported_objects')[0];

    await expect(updateChannelImportEntity(
      'booking_channel_imported_objects',
      imported.id,
      { match_status: 'ignored' },
      connectionB.id,
    )).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(imported.match_status).not.toBe('ignored');
  });

  it('rejects booking creation through another connection', async () => {
    const connectionA = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: 'acct-access-import' });
    const connectionB = await initializeChannelManagerConnection(PROPERTY_ID, 'bnovo', { accountId: 'acct-access-import' });
    await importChannelBookings(connectionA.id, [{ external_booking_id: 'book-guarded' }]);
    const imported = rows('booking_channel_imported_bookings')[0];
    const intakeCallsBefore = processInboundBookingRequest.mock.calls.length;

    await expect(createBookingFromImportedChannelBooking(imported.id, {
      connectionId: connectionB.id,
      accountId: 'acct-access-import',
      propertyId: 'prop-a',
    })).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(processInboundBookingRequest).toHaveBeenCalledTimes(intakeCallsBefore);
  });

  it('rejects secret fields in provider onboarding metadata', async () => {
    await expect(performChannelManagerProviderOnboardingAction({
      action: 'select_provider', propertySetupId: PROPERTY_ID, provider: 'travelline', metadata: { password: 'never-store-this' },
    })).rejects.toThrow(/секреты/i);
  });
});

describe('Channel Manager dashboard API auth', () => {
  it('returns 401 for every unauthenticated dashboard endpoint', async () => {
    vi.doMock('@/lib/crm/api-auth', () => ({
      requireCrmOperatorSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
      requireOpsAdminSession: vi.fn(async () => ({ error: Response.json({ ok: false }, { status: 401 }) })),
    }));
    const endpoints = await Promise.all([
      import('@/app/api/dashboard/channel-manager/connections/route'), import('@/app/api/dashboard/channel-manager/import-runs/route'),
      import('@/app/api/dashboard/channel-manager/imported-objects/route'), import('@/app/api/dashboard/channel-manager/imported-bookings/route'),
      import('@/app/api/dashboard/channel-manager/calendar/route'), import('@/app/api/dashboard/channel-manager/reconcile/route'),
      import('@/app/api/dashboard/channel-manager/provider-onboarding/route'),
      import('@/app/api/dashboard/channel-manager/provider-onboarding/action/route'),
    ]);
    const responses = await Promise.all([
      endpoints[0].GET(new Request('http://localhost')), endpoints[1].GET(new Request('http://localhost')),
      endpoints[2].GET(new Request('http://localhost')), endpoints[3].GET(new Request('http://localhost')),
      endpoints[4].GET(new Request('http://localhost')), endpoints[5].POST(new Request('http://localhost', { method: 'POST', body: '{}' })),
      endpoints[6].GET(new Request('http://localhost')), endpoints[7].POST(new Request('http://localhost', { method: 'POST', body: '{}' })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401]);
  });
});
