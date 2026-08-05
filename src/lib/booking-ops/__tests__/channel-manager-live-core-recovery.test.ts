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
  private deleteCalls = 0;
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
      this.deleteCalls += 1;
      const removed = this.filtered;
      const removedKeys = removed.map((row) => String(row.id ?? row.booking_id));
      tables[this.table] = rows(this.table).filter((row) => !removedKeys.includes(String(row.id ?? row.booking_id)));
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
  RECOVERY_ALLOWLISTED_DIRECT_CHILDREN,
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

let deleteInvocations: Array<{ table: string }> = [];

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

function mockFkOk(edges: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, blocker_code: 'none', blocker_summary: null, edges }, error: null };
}

function mockCleanupRpcPassed(deletedCountsByTable: Record<string, number>) {
  return {
    data: {
      status: 'passed',
      transaction_committed: true,
      blocker_code: 'none',
      blocker_summary: null,
      safe_error: null,
      deleted_counts_by_table: deletedCountsByTable,
      post_verification: {
        deterministicIdentityGone: true,
        descendantsRemain: false,
        descendantCount: 0,
        contourPreserved: true,
        importRunsPreserved: true,
      },
    },
    error: null,
  };
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  deleteInvocations = [];
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
    delete: () => {
      deleteInvocations.push({ table });
      return new Query(table, { deleteMode: true });
    },
  }));
  supabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
      return mockFkOk();
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

  it('uses reviewed FK mappings for guest_intake_sessions and autopilot_states', () => {
    const intake = RECOVERY_ALLOWLISTED_DIRECT_CHILDREN.find((item) => item.table === 'booking_ops_guest_intake_sessions');
    const autopilot = RECOVERY_ALLOWLISTED_DIRECT_CHILDREN.find((item) => item.table === 'booking_ops_autopilot_states');
    expect(intake).toEqual({
      table: 'booking_ops_guest_intake_sessions',
      column: 'booking_ops_record_id',
      pkColumn: 'id',
      relationship: 'direct_fk_guest_intake',
    });
    expect(autopilot).toEqual({
      table: 'booking_ops_autopilot_states',
      column: 'booking_id',
      pkColumn: 'booking_id',
      relationship: 'direct_fk_autopilot_states',
    });
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

  it('preview collects guest_intake_sessions via booking_ops_record_id', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const sessionId = randomUUID();
    rows('booking_ops_guest_intake_sessions').push({
      id: sessionId,
      booking_ops_record_id: orphanId,
      booking_id: 'external-not-used-as-fk',
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);
    expect(preview.exactIdsByTable.booking_ops_guest_intake_sessions).toEqual([sessionId]);
  });

  it('preview collects autopilot_states keyed by booking_id PK', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_ops_autopilot_states').push({
      booking_id: orphanId,
      state: 'idle',
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);
    expect(preview.exactIdsByTable.booking_ops_autopilot_states).toEqual([orphanId]);
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

  it('preview blocks booking_channel_imported_bookings SET NULL edge', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_channel_imported_bookings').push({
      id: randomUUID(),
      matched_booking_id: orphanId,
      external_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('unknown_fk_descendant');
    expect(String(preview.blockerSummary ?? '')).toMatch(/SET NULL|imported bookings/i);
  });

  it('preview blocks unknown FK descendants from live probe', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const childId = randomUUID();
    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
        return mockFkOk([{
          table_name: 'mysterious_booking_child',
          column_name: 'booking_id',
          delete_action: 'c',
          pk_column: 'id',
          deletable: false,
          row_count: 1,
          child_keys: [childId],
        }]);
      }
      return { data: null, error: { message: 'function missing' } };
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('unknown_fk_descendant');
    expect(preview.mainRecord?.id).toBe(orphanId);
  });

  it('preview blocks when live FK discovery fails closed', async () => {
    seedContour();
    seedLegacyOrphan();
    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
        return {
          data: {
            ok: false,
            blocker_code: 'unknown_fk_descendant',
            blocker_summary: 'Uninspectable FK edge booking_ops_no_id_child.booking_id pk=id',
            edges: [],
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'function missing' } };
    });
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('cleanup_failed');
    expect(String(preview.blockerSummary ?? '')).toMatch(/Uninspectable FK edge/i);
  });

  it('preview fails closed on wrong FK-column / missing column mapping', async () => {
    seedContour();
    seedLegacyOrphan();
    supabaseFrom.mockImplementation((table: string) => ({
      select: () => {
        if (table === 'booking_ops_guest_intake_sessions') {
          return {
            eq: () => ({
              then(resolve: (value: { data: null; error: { code: string; message: string } }) => void) {
                resolve({
                  data: null,
                  error: { code: '42703', message: 'column booking_ops_record_id does not exist' },
                });
              },
            }),
          };
        }
        return new Query(table);
      },
      insert: () => new Query(table),
      update: (patch: Row) => new Query(table, { patch }),
      delete: () => new Query(table, { deleteMode: true }),
    }));

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(false);
    expect(preview.blockerCode).toBe('cleanup_failed');
    expect(String(preview.blockerSummary ?? '')).toMatch(/booking_ops_guest_intake_sessions/);
  });

  it('RPC unavailable: dry-run may preview, committed cleanup blocks without REST DELETE', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_ops_events').push({ id: randomUUID(), booking_ops_record_id: orphanId });

    const dryRun = await cleanupLiveCoreSyntheticRecovery({ dryRun: true });
    expect(dryRun.status).toBe('passed');
    expect(dryRun.transactionCommitted).toBe(false);
    expect(dryRun.postVerification.schemaRpcUnavailable).toBe(true);
    expect(deleteInvocations).toHaveLength(0);
    expect(rows('booking_ops_records')).toHaveLength(1);

    const committed = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(committed.status).toBe('blocked');
    expect(committed.blockerCode).toBe('schema_rpc_unavailable');
    expect(committed.transactionCommitted).toBe(false);
    expect(deleteInvocations).toHaveLength(0);
    expect(rows('booking_ops_records')).toHaveLength(1);
    expect(rows('booking_ops_events')).toHaveLength(1);
  });

  it('partial REST cleanup is impossible when RPC is unavailable', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const taskId = randomUUID();
    rows('booking_ops_tasks').push({ id: taskId, booking_ops_record_id: orphanId });

    await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });

    expect(deleteInvocations).toEqual([]);
    expect(rows('booking_ops_tasks').some((row) => row.id === taskId)).toBe(true);
    expect(rows('booking_ops_records').some((row) => row.id === orphanId)).toBe(true);
  });

  it('cleanup via transactional RPC deletes exact verified descendants and preserves contour', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const taskId = randomUUID();
    const eventId = randomUUID();
    rows('booking_ops_tasks').push({ id: taskId, booking_ops_record_id: orphanId });
    rows('booking_ops_events').push({ id: eventId, booking_ops_record_id: orphanId });

    supabaseRpc.mockImplementation(async (fn: string, payload?: Record<string, unknown>) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        expect(payload?.p_dry_run).toBe(false);
        expect(payload?.p_booking_ops_record_id).toBe(orphanId);
        const manifest = payload?.p_deletion_manifest as Record<string, string[]>;
        expect(manifest.booking_ops_tasks).toEqual([taskId]);
        expect(manifest.booking_ops_events).toEqual([eventId]);
        // Simulate successful transactional cleanup by removing orphan rows in the fixture.
        tables.booking_ops_tasks = [];
        tables.booking_ops_events = [];
        tables.booking_ops_records = [];
        return mockCleanupRpcPassed({
          booking_ops_tasks: 1,
          booking_ops_events: 1,
          booking_ops_records: 1,
        });
      }
      return { data: null, error: { message: 'unexpected rpc' } };
    });

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });

    expect(result.status).toBe('passed');
    expect(result.transactionCommitted).toBe(true);
    expect(result.deletedCountsByTable.booking_ops_records).toBe(1);
    expect(result.deletedCountsByTable.booking_ops_tasks).toBe(1);
    expect(result.deletedCountsByTable.booking_ops_events).toBe(1);
    expect(deleteInvocations).toHaveLength(0);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === OWNER_ID)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === PROPERTY_SETUP_ID)).toBe(true);
    expect(rows('booking_channel_manager_connections').some((row) => row.id === CONNECTION_ID)).toBe(true);
    expect(rows('booking_channel_import_runs').some((row) => row.id === IMPORT_RUN_ID)).toBe(true);
  });

  it('extra manifest ID belonging to another booking is rejected by RPC contract', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const foreignTaskId = randomUUID();
    rows('booking_ops_tasks').push({ id: foreignTaskId, booking_ops_record_id: orphanId });

    supabaseRpc.mockImplementation(async (fn: string, payload?: Record<string, unknown>) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        const manifest = payload?.p_deletion_manifest as Record<string, string[]>;
        const injected = randomUUID();
        const keys = [...(manifest.booking_ops_tasks ?? []), injected];
        // Application always sends preview IDs; RPC must reject extras that do not belong.
        return {
          data: {
            status: 'blocked',
            transaction_committed: false,
            blocker_code: 'row_changed',
            blocker_summary: 'Manifest contains IDs not belonging to orphan on booking_ops_tasks',
            safe_error: 'extra_manifest_id',
            deleted_counts_by_table: {},
            post_verification: {},
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unexpected' } };
    });

    // Force a cleanup call that returns the RPC blocked payload for foreign IDs.
    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(result.status).toBe('blocked');
    expect(result.blockerCode).toBe('row_changed');
    expect(String(result.safeError ?? '')).toMatch(/extra_manifest_id/);
    expect(rows('booking_ops_records')).toHaveLength(1);
    expect(deleteInvocations).toHaveLength(0);
  });

  it('changed child between preview and cleanup rolls back / blocks without REST mutation', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const taskId = randomUUID();
    rows('booking_ops_tasks').push({ id: taskId, booking_ops_record_id: orphanId });

    let cleanupCalls = 0;
    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        cleanupCalls += 1;
        return {
          data: {
            status: 'blocked',
            transaction_committed: false,
            blocker_code: 'row_changed',
            blocker_summary: 'Manifest mismatch for booking_ops_tasks.booking_ops_record_id',
            safe_error: 'manifest_child_mismatch',
            deleted_counts_by_table: {},
            post_verification: {},
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unexpected' } };
    });

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);
    rows('booking_ops_tasks').push({ id: randomUUID(), booking_ops_record_id: orphanId });

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(cleanupCalls).toBe(1);
    expect(result.status).toBe('blocked');
    expect(result.blockerCode).toBe('row_changed');
    expect(result.transactionCommitted).toBe(false);
    expect(deleteInvocations).toHaveLength(0);
    expect(rows('booking_ops_records')).toHaveLength(1);
  });

  it('failure after several DELETE statements rolls back all rows (RPC reports failed, no REST deletes)', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_ops_tasks').push({ id: randomUUID(), booking_ops_record_id: orphanId });
    rows('booking_ops_events').push({ id: randomUUID(), booking_ops_record_id: orphanId });

    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        return {
          data: {
            status: 'failed',
            transaction_committed: false,
            blocker_code: 'cleanup_failed',
            blocker_summary: 'Transactional cleanup rolled back.',
            safe_error: 'deleted_count_mismatch:booking_ops_events:1:0',
            deleted_counts_by_table: {},
            post_verification: { descendantsRemain: true },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unexpected' } };
    });

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(result.status).toBe('failed');
    expect(result.transactionCommitted).toBe(false);
    expect(result.postVerification.descendantsRemain).toBe(true);
    expect(deleteInvocations).toHaveLength(0);
    expect(rows('booking_ops_records')).toHaveLength(1);
    expect(rows('booking_ops_tasks')).toHaveLength(1);
    expect(rows('booking_ops_events')).toHaveLength(1);
  });

  it('post-check detecting a remaining descendant fails closed without commit', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    rows('booking_ops_events').push({ id: randomUUID(), booking_ops_record_id: orphanId });

    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        return {
          data: {
            status: 'failed',
            transaction_committed: false,
            blocker_code: 'cleanup_failed',
            blocker_summary: 'Transactional cleanup rolled back.',
            safe_error: 'descendants_remain:1',
            deleted_counts_by_table: {},
            post_verification: { descendantsRemain: true, descendantCount: 1 },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unexpected' } };
    });

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(result.status).toBe('failed');
    expect(result.transactionCommitted).toBe(false);
    expect(result.safeError).toMatch(/descendants_remain/);
    expect(deleteInvocations).toHaveLength(0);
  });

  it('changed main row between preview and cleanup causes block', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.safeToCleanup).toBe(true);

    rows('booking_ops_records')[0].guest_phone = '+79991112233';

    const result = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(result.status).toBe('blocked');
    expect(['contact_present', 'row_changed', 'schema_rpc_unavailable']).toContain(result.blockerCode);
    expect(rows('booking_ops_records')).toHaveLength(1);
    expect(deleteInvocations).toHaveLength(0);
  });

  it('repeated cleanup after successful RPC is safe and returns already-clean', async () => {
    seedContour();
    const orphanId = seedLegacyOrphan();
    let phase: 'first' | 'second' = 'first';

    supabaseRpc.mockImplementation(async (fn: string) => {
      if (fn === 'channel_manager_live_core_booking_ops_fk_children') return mockFkOk();
      if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
        if (phase === 'first') {
          tables.booking_ops_records = [];
          return mockCleanupRpcPassed({ booking_ops_records: 1 });
        }
        return {
          data: {
            status: 'already_clean',
            transaction_committed: false,
            blocker_code: 'already_clean',
            deleted_counts_by_table: {},
            post_verification: { deterministicIdentityGone: true, descendantsRemain: false },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unexpected' } };
    });

    const first = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: orphanId,
    });
    expect(first.status).toBe('passed');

    phase = 'second';
    const second = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
    });
    expect(second.status).toBe('already_clean');
    expect(second.transactionCommitted).toBe(false);
  });
});
