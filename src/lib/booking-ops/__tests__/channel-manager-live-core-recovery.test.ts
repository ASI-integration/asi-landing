import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;

const { supabaseRpc, supabaseFrom } = vi.hoisted(() => ({
  supabaseRpc: vi.fn(),
  supabaseFrom: vi.fn(),
}));

const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

class Query {
  private filtered: Row[];
  private deleteMode = false;
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean; deleteMode?: boolean } = {}) {
    this.filtered = [...rows(table)];
    this.deleteMode = options.deleteMode === true;
  }
  eq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filtered = this.filtered.filter((row) => values.includes(row[column]));
    return this;
  }
  contains(column: string, value: Record<string, unknown>) {
    this.filtered = this.filtered.filter((row) => {
      const meta = row[column] ?? {};
      return Object.entries(value).every(([key, expected]) => meta[key] === expected);
    });
    return this;
  }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select() { return this; }
  private execute() {
    if (this.deleteMode) {
      const removed = this.filtered;
      const removedIds = removed.map((row) => String(row.id));
      tables[this.table] = rows(this.table).filter((row) => !removedIds.includes(String(row.id)));
      return { data: removed, error: null, count: removed.length };
    }
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
    from: (...args: unknown[]) => supabaseFrom(...args),
    rpc: (...args: unknown[]) => supabaseRpc(...args),
  },
}));

import {
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_GUEST_NAME,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
  LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
} from '../channel-manager-live-core-acceptance-constants';
import {
  cleanupLiveCoreSyntheticRecovery,
  previewLiveCoreSyntheticRecovery,
} from '../channel-manager-live-core-recovery';
import {
  buildLiveCoreAcceptanceReservationMetadata,
  resolveAcceptanceReservationMetadataForCreate,
  runWithLiveCoreAcceptanceCreateContext,
} from '../channel-manager-live-core-acceptance-context';

const OWNER_ID = '39e6b608-a6d9-413f-9b4d-02d1e4d81890';
const PROPERTY_SETUP_ID = '1a14e03b-465d-4000-be05-c06f452818a1';
const CONNECTION_ID = '9f97a660-81f8-4583-9125-f95216f8dd03';
const IMPORT_RUN_ID = 'c9fe1308-e0c3-4c90-9131-b0ef33f67bf1';

function seedContour() {
  rows('booking_owner_setup_profiles').push({
    id: OWNER_ID,
    lead_id: 'acceptance:channel_manager_live_core_v1',
    metadata: { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS },
  });
  rows('booking_property_setup_profiles').push({
    id: PROPERTY_SETUP_ID,
    owner_setup_id: OWNER_ID,
    property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
    metadata: { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS },
  });
  rows('booking_channel_manager_connections').push({
    id: CONNECTION_ID,
    property_setup_id: PROPERTY_SETUP_ID,
    owner_setup_id: OWNER_ID,
    provider: 'manual',
    metadata: { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS },
  });
  rows('booking_channel_import_runs').push({
    id: IMPORT_RUN_ID,
    connection_id: CONNECTION_ID,
    status: 'failed',
    import_type: 'initial_sync',
    created_at: new Date().toISOString(),
  });
}

function seedLegacyOrphan(overrides: Row = {}) {
  const id = String(overrides.id ?? randomUUID());
  rows('booking_ops_records').push({
    id,
    account_id: null,
    property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
    booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
    guest_name: LIVE_CORE_ACCEPTANCE_GUEST_NAME,
    guest_phone: null,
    guest_email: null,
    guest_telegram: null,
    ota_source: 'channel_manager',
    reservation_metadata: {},
    created_at: new Date().toISOString(),
    ...overrides,
  });
  return id;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  supabaseRpc.mockReset();
  supabaseFrom.mockReset();
  supabaseFrom.mockImplementation((table: string) => ({
    select: () => new Query(table),
    insert: (input: Row | Row[]) => {
      const incoming = Array.isArray(input) ? input : [input];
      rows(table).push(...incoming.map((row) => ({ ...row })));
      const query = new Query(table);
      (query as any).filtered = incoming;
      return query;
    },
    update: (patch: Row) => new Query(table, { patch }),
    delete: () => new Query(table, { deleteMode: true }),
  }));
  supabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
      return { data: [], error: null };
    }
    return {
      data: null,
      error: { message: 'function channel_manager_live_core_synthetic_recovery_cleanup does not exist' },
    };
  });
});

describe('Live Core synthetic recovery', () => {
  it('attaches harness metadata before failure-prone processing via create context', async () => {
    const acceptanceExecutionId = randomUUID();
    const metadata = buildLiveCoreAcceptanceReservationMetadata({ acceptanceExecutionId, importRunId: IMPORT_RUN_ID });
    const resolved = await runWithLiveCoreAcceptanceCreateContext({
      acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS,
      acceptanceExecutionId,
      importRunId: IMPORT_RUN_ID,
      reservationMetadata: metadata,
    }, async () => resolveAcceptanceReservationMetadataForCreate({
      propertyId: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      bookingId: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
    }));
    expect(resolved?.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
    expect(resolved?.acceptanceExecutionId).toBe(acceptanceExecutionId);
    expect(resolveAcceptanceReservationMetadataForCreate({
      propertyId: 'other-property',
      bookingId: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
    })).toBeNull();
  });

  it('preview returns safe for a valid synthetic orphan', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const eventId = randomUUID();
    rows('booking_ops_events').push({
      id: eventId,
      booking_ops_record_id: orphanId,
    });

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.recoveryRequired).toBe(true);
    expect(preview.safeToCleanup).toBe(true);
    expect(preview.mainRecord?.id).toBe(orphanId);
    expect(preview.mainRecord?.classification).toBe('legacy_synthetic_candidate');
    expect(preview.countsByTable.booking_ops_events).toBe(1);
    expect(preview.exactIdsByTable.booking_ops_events).toEqual([eventId]);
    expect(preview.preservedContour.connectionId).toBe(CONNECTION_ID);
    expect(preview.importRunIds).toContain(IMPORT_RUN_ID);
    expect(preview.expectedDeletionTotal).toBe(2);
  });

  it('preview blocks a row with phone/email/account_id', async () => {
    seedContour();
    seedLegacyOrphan({ guest_phone: '+79990001122' });
    const phonePreview = await previewLiveCoreSyntheticRecovery();
    expect(phonePreview.safeToCleanup).toBe(false);
    expect(phonePreview.blockerCode).toBe('contact_present');

    for (const key of Object.keys(tables)) tables[key] = [];
    seedContour();
    seedLegacyOrphan({ account_id: 'acct-1' });
    const accountPreview = await previewLiveCoreSyntheticRecovery();
    expect(accountPreview.safeToCleanup).toBe(false);
    expect(accountPreview.blockerCode).toBe('account_present');
  });

  it('preview blocks deliveries', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const intentId = randomUUID();
    rows('booking_ops_communication_intents').push({
      id: intentId,
      booking_ops_record_id: orphanId,
    });
    rows('booking_ops_communication_deliveries').push({
      id: randomUUID(),
      communication_intent_id: intentId,
      booking_id: orphanId,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('deliveries_present');
  });

  it('preview blocks payments', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_deposits').push({
      id: randomUUID(),
      booking_id: orphanId,
      amount: 1000,
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('payments_present');
  });

  it('preview blocks unknown FK descendants', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
        return {
          data: [{
            table_name: 'mysterious_booking_child',
            column_name: 'booking_id',
            child_id: randomUUID(),
            delete_action: 'c',
          }],
          error: null,
        };
      }
      return { data: null, error: { message: 'function missing' } };
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('unknown_fk_descendant');
    expect(preview.mainRecord?.id).toBe(orphanId);
  });

  it('cleanup deletes exact verified descendants and preserves contour/import runs', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const taskId = randomUUID();
    const eventId = randomUUID();
    rows('booking_ops_tasks').push({ id: taskId, booking_ops_record_id: orphanId });
    rows('booking_ops_events').push({ id: eventId, booking_ops_record_id: orphanId });

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });

    expect(result.status).toBe('passed');
    expect(result.deletedCountsByTable.booking_ops_records).toBe(1);
    expect(result.deletedCountsByTable.booking_ops_tasks).toBe(1);
    expect(result.deletedCountsByTable.booking_ops_events).toBe(1);
    expect(rows('booking_ops_records')).toHaveLength(0);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === OWNER_ID)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === PROPERTY_SETUP_ID)).toBe(true);
    expect(rows('booking_channel_manager_connections').some((row) => row.id === CONNECTION_ID)).toBe(true);
    expect(rows('booking_channel_import_runs').some((row) => row.id === IMPORT_RUN_ID)).toBe(true);
  });

  it('changed row between preview and cleanup causes rollback/block', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);

    // Mutate identity after preview.
    rows('booking_ops_records')[0].guest_phone = '+79991112233';

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(result.status).toBe('blocked');
    expect(['contact_present', 'row_changed']).toContain(result.blockerCode);
    expect(rows('booking_ops_records')).toHaveLength(1);
  });

  it('repeated cleanup is safe and returns already-clean/no-op', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const first = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(first.status).toBe('passed');

    const second = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
    });
    expect(second.status).toBe('already_clean');
    expect(second.transactionCommitted).toBe(false);
  });
});
