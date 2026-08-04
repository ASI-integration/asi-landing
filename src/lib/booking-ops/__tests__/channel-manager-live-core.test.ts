import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = Record<string, any>;
const {
  processInboundBookingRequest,
  canAutoSendCommunicationIntent,
  updateBookingOpsRecord,
} = vi.hoisted(() => ({
  processInboundBookingRequest: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
}));
const tables: Record<string, Row[]> = {};

function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean } = {}) {
    this.filtered = [...rows(table)];
  }
  eq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] !== value); return this; }
  gte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value)); return this; }
  lte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value)); return this; }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head };
    return this;
  }
  private execute() {
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    return { data: this.options.head ? null : this.filtered, error: null, count: this.options.count ? this.filtered.length : null };
  }
  async single() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: result.data?.[0] ? null : { message: 'not found' } };
  }
  async maybeSingle() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: null };
  }
  then(resolve: (value: ReturnType<Query['execute']>) => void) { resolve(this.execute()); }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn((_columns = '*', options?: { count?: string; head?: boolean }) => new Query(table, { count: Boolean(options?.count), head: options?.head })),
      insert: vi.fn((input: Row | Row[]) => {
        const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }));
        rows(table).push(...inserted);
        return new Query(table).eq('id', inserted[0]?.id).select();
      }),
      upsert: vi.fn((input: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        const incoming = Array.isArray(input) ? input : [input];
        const affected: Row[] = [];
        for (const candidate of incoming) {
          const keys = options?.onConflict?.split(',') ?? ['id'];
          const existing = rows(table).find((row) => keys.every((key) => row[key] === candidate[key]));
          if (existing) {
            if (!options?.ignoreDuplicates) Object.assign(existing, candidate);
            affected.push(existing);
          } else {
            const stored = { ...candidate };
            rows(table).push(stored);
            affected.push(stored);
          }
        }
        const query = new Query(table);
        (query as any).filtered = affected;
        return query;
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
vi.mock('../repository', () => ({ updateBookingOpsRecord }));
vi.mock('../availability-overbooking-protection', () => ({
  auditChannelImportAvailability: vi.fn(async () => []),
}));

import { initializeChannelManagerConnection } from '../channel-manager-access-import';
import {
  ManualChannelLiveCoreAdapter,
  acquireChannelLiveSyncGuard,
  classifyBookingChange,
  createChannelLiveCoreAdapter,
  getChannelLiveCoreStatus,
  normalizeExternalBookingStatus,
  redactLiveCoreErrorMessage,
  releaseChannelLiveSyncGuard,
  runChannelManagerInitialSync,
  toChannelLiveSafeError,
} from '../channel-manager-live-core';
import { ASI_PRODUCT_ROADMAP } from '@/lib/roadmap/asi-product-roadmap';
import { allRoadmapStages } from '@/lib/roadmap/summary';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    objects: [{
      external_object_id: 'ext-1',
      title: 'Лесной дом',
      city: 'Тверь',
      capacity: 4,
      property_setup_id: PROPERTY_ID,
      ...(overrides.object as Row | undefined),
    }],
    bookings: [{
      external_booking_id: 'book-1',
      external_object_id: 'ext-1',
      guest_safe_name: 'Анна',
      checkin_date: '2026-07-10',
      checkout_date: '2026-07-12',
      status: 'confirmed',
      ...(overrides.booking as Row | undefined),
    }],
    calendar: [{ external_object_id: 'ext-1', date: '2026-07-10', availability_status: 'booked' }],
    pricing: [{ external_object_id: 'ext-1', date: '2026-07-11', price_amount: 5000, currency: 'RUB' }],
  };
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push({
    id: PROPERTY_ID,
    owner_setup_id: OWNER_ID,
    property_id: 'prop-a',
    title: 'Лесной дом',
    address_city: 'Тверь',
    guest_capacity: 4,
    channel_access_status: 'not_requested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  canAutoSendCommunicationIntent.mockReset();
  processInboundBookingRequest.mockReset();
  updateBookingOpsRecord.mockReset();
  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockResolvedValue({ bookingId: BOOKING_OPS_ID, intakeStatus: 'processed' });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
});

describe('Channel Manager Live Core adapter contract', () => {
  it('normalizes booking statuses and change kinds without credentials', async () => {
    expect(normalizeExternalBookingStatus('CONFIRMED')).toBe('confirmed');
    expect(normalizeExternalBookingStatus('canceled')).toBe('cancelled');
    expect(normalizeExternalBookingStatus('restored')).toBe('restored');
    expect(classifyBookingChange('confirmed', 'cancelled')).toBe('cancelled');
    expect(classifyBookingChange('cancelled', 'confirmed')).toBe('restored');
    expect(classifyBookingChange(null, 'new')).toBe('created');

    const adapter = new ManualChannelLiveCoreAdapter(baseSnapshot());
    expect(adapter.capabilities.writePrices).toBe(false);
    expect(adapter.capabilities.incrementalCursor).toBe(false);
    expect(adapter.getIdentity().supportsRealApi).toBe(false);
    const snapshot = await adapter.loadInitialSnapshot();
    expect(snapshot.properties[0]?.externalObjectId).toBe('ext-1');
    expect(snapshot.bookings[0]?.status).toBe('confirmed');
    expect(snapshot.cursors.every((item) => item.checkpoint === null)).toBe(true);
    expect(JSON.stringify(adapter)).not.toMatch(/password|token|secret/i);
  });

  it('keeps manual adapter compatible with existing snapshot validation', async () => {
    expect(() => createChannelLiveCoreAdapter('manual')).toThrow(/снимок/i);
    expect(() => createChannelLiveCoreAdapter('manual', {
      snapshot: { objects: [{ external_object_id: 'x', api_token: 'leak' }] },
    })).toThrow(/секреты/i);
    const adapter = createChannelLiveCoreAdapter('bnovo', { snapshot: baseSnapshot() });
    expect(adapter.provider).toBe('manual');
    expect(await adapter.listExternalProperties()).toHaveLength(1);
  });

  it('redacts secrets from safe errors', () => {
    expect(redactLiveCoreErrorMessage('failed bearer abcdefghijklmnop')).toContain('[redacted]');
    const safe = toChannelLiveSafeError('load_provider_data', new Error('token=super-secret-value'));
    expect(safe.message).not.toMatch(/super-secret-value/);
    expect(safe.retryable).toBe(true);
  });
});

describe('Channel Manager Live Core initial sync', () => {
  it('imports a new booking through existing Booking Intake', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const result = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(result.status).not.toBe('failed');
    expect(result.counters.imported).toBe(1);
    expect(result.counters.objects).toBe(1);
    expect(processInboundBookingRequest).toHaveBeenCalledOnce();
    expect(rows('booking_channel_imported_bookings')[0]).toMatchObject({
      external_booking_id: 'book-1',
      matched_booking_id: BOOKING_OPS_ID,
      match_status: 'imported_to_booking_ops',
    });
    expect(rows('booking_channel_import_runs')[0].import_type).toBe('initial_sync');
  });

  it('retries without creating a duplicate booking', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const first = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(first.counters.imported).toBe(1);
    processInboundBookingRequest.mockClear();
    processInboundBookingRequest.mockResolvedValue({ bookingId: BOOKING_OPS_ID, intakeStatus: 'duplicate' });
    const second = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(second.status).not.toBe('failed');
    expect(second.counters.imported).toBe(0);
    expect(second.counters.skipped + second.counters.updated).toBeGreaterThanOrEqual(1);
    expect(rows('booking_channel_imported_bookings')).toHaveLength(1);
  });

  it('updates an existing external booking when dates change', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });
    processInboundBookingRequest.mockClear();
    const updated = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: baseSnapshot({ booking: { checkin_date: '2026-07-11', checkout_date: '2026-07-13', status: 'modified' } }),
    });
    expect(updated.counters.updated).toBe(1);
    expect(updateBookingOpsRecord).toHaveBeenCalled();
    expect(processInboundBookingRequest).not.toHaveBeenCalled();
  });

  it('applies external cancellation safely', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });
    const cancelled = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: baseSnapshot({ booking: { status: 'cancelled' } }),
    });
    expect(cancelled.counters.cancelled).toBe(1);
    expect(rows('booking_ops_records')[0].normalized_status).toBe('cancelled');
  });

  it('skips bookings for unmatched properties', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: {
        objects: [{ external_object_id: 'unknown', title: 'Другой', city: 'Омск' }],
        bookings: [{ external_booking_id: 'book-x', external_object_id: 'unknown', status: 'confirmed' }],
        calendar: [],
        pricing: [],
      },
    });
    expect(result.counters.imported).toBe(0);
    expect(result.counters.skipped).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((item) => item.type === 'object_not_confirmed')).toBe(true);
    expect(processInboundBookingRequest).not.toHaveBeenCalled();
  });

  it('skips possible duplicates without creating a second booking', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    rows('booking_ops_records').push({
      id: '40000000-0000-4000-8000-000000000004',
      booking_id: 'other',
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T12:00:00.000Z',
      check_out_at: '2026-07-12T12:00:00.000Z',
      normalized_status: 'confirmed',
    });
    const result = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(result.counters.imported).toBe(0);
    expect(result.counters.skipped).toBeGreaterThanOrEqual(1);
    expect(rows('booking_channel_imported_bookings')[0].match_status).toBe('possible_duplicate');
  });

  it('records partial provider failure with exact stage and preserves evidence', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const first = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: {
        objects: [{ external_object_id: 'ext-1', title: 'Лесной дом', city: 'Тверь', capacity: 4, property_setup_id: PROPERTY_ID }],
        bookings: [],
        calendar: [],
        pricing: [],
      },
    });
    expect(first.status).not.toBe('failed');
    expect(rows('booking_channel_imported_objects')).toHaveLength(1);

    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: {
        objects: [{ external_object_id: 'ext-1', title: 'Лесной дом', city: 'Тверь', capacity: 4 }],
        bookings: [{ external_booking_id: 'book-secret', password: 'never-store' }],
        calendar: [],
        pricing: [],
      },
    });
    expect(result.status).toBe('failed');
    expect(result.safeError?.stage).toBe('load_provider_data');
    expect(result.safeError?.message).not.toMatch(/never-store/);
    expect(result.retryable).toBe(true);
    expect(rows('booking_channel_imported_objects')).toHaveLength(1);
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.blocker).toBeTruthy();
    expect(status.latestRun?.status).toBe('failed');
  });

  it('enforces a per-connection execution guard', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const first = await acquireChannelLiveSyncGuard(connection.id);
    expect(first.ok).toBe(true);
    const second = await acquireChannelLiveSyncGuard(connection.id);
    expect(second.ok).toBe(false);
    if (first.ok) await releaseChannelLiveSyncGuard(connection.id, first.lockId);
    const third = await acquireChannelLiveSyncGuard(connection.id);
    expect(third.ok).toBe(true);
  });

  it('exposes dashboard live-core status fields', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.liveCoreEnabled).toBe(true);
    expect(status.incrementalSyncEnabled).toBe(false);
    expect(status.realProviderApiEnabled).toBe(false);
    expect(status.provider).toBe('manual');
    expect(status.counters?.imported).toBe(1);
    expect(status.lastSuccessfulSyncAt).toBeTruthy();
  });
});

describe('Channel Manager Live Core roadmap honesty', () => {
  it('marks Live Core done and keeps incremental sync unfinished', () => {
    const byId = Object.fromEntries(allRoadmapStages(ASI_PRODUCT_ROADMAP).map((stage) => [stage.id, stage]));
    expect(byId['ch-live-core']?.status).toBe('done');
    expect(byId['ch-live-core']?.currentState).toMatch(/Live Core/i);
    expect(byId['ch-initial-incremental-sync']?.status).toBe('in_progress');
    expect(byId['ch-initial-incremental-sync']?.currentState).toMatch(/incremental/i);
    expect(byId['ch-first-real-adapter']?.status).toBe('blocked');
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('channel-live-core-status');
    expect(panel).toContain('Запустить initial sync');
  });
});
