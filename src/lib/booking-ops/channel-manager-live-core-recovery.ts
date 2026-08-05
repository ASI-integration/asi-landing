/**
 * Owner-only Channel Manager Live Core synthetic artifact recovery.
 *
 * Preview classifies deterministic acceptance orphans as harness-owned,
 * legacy synthetic candidates, or unknown/unsafe. Cleanup deletes only
 * exact verified IDs inside a service-role transactional RPC.
 *
 * Fail closed. Never adopt/relabel unknown rows. Never delete contour
 * owner/property/connection or import-run history.
 */

import { supabase } from '@/lib/supabase';
import {
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_GUEST_NAME,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
  LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
  LEGACY_FAILED_RUN_CORRELATION_AFTER_MS,
  LEGACY_FAILED_RUN_CORRELATION_BEFORE_MS,
} from './channel-manager-live-core-acceptance-constants';

export type RecoveryRowClassification = 'harness_owned' | 'legacy_synthetic_candidate' | 'unknown_unsafe';

export type RecoveryDescendantRow = {
  table: string;
  id: string;
  relationship: string;
  classification: RecoveryRowClassification;
};

export type RecoveryBlockerCode =
  | 'none'
  | 'no_candidate'
  | 'already_clean'
  | 'contact_present'
  | 'account_present'
  | 'metadata_not_empty'
  | 'payments_present'
  | 'deliveries_present'
  | 'real_messages_present'
  | 'unknown_fk_descendant'
  | 'identity_mismatch'
  | 'contour_mismatch'
  | 'ambiguous_candidate'
  | 'confirmation_required'
  | 'confirmation_mismatch'
  | 'row_changed'
  | 'cleanup_failed'
  | 'schema_rpc_unavailable';

export type LiveCoreRecoveryPreview = {
  recoveryRequired: boolean;
  safeToCleanup: boolean;
  blockerCode: RecoveryBlockerCode;
  blockerSummary: string | null;
  mainRecord: {
    id: string;
    propertyId: string | null;
    bookingId: string | null;
    guestName: string | null;
    accountId: string | null;
    otaSource: string | null;
    reservationMetadata: Record<string, unknown>;
    classification: RecoveryRowClassification;
    createdAt: string | null;
  } | null;
  descendantManifest: RecoveryDescendantRow[];
  countsByTable: Record<string, number>;
  exactIdsByTable: Record<string, string[]>;
  preservedContour: {
    ownerSetupId: string | null;
    propertySetupId: string | null;
    connectionId: string | null;
  };
  importRunIds: string[];
  expectedDeletionTotal: number;
  evidence: Record<string, unknown>;
};

export type LiveCoreRecoveryCleanupResult = {
  status: 'passed' | 'blocked' | 'failed' | 'already_clean';
  transactionCommitted: boolean;
  dryRun: boolean;
  deletedCountsByTable: Record<string, number>;
  preservedContour: LiveCoreRecoveryPreview['preservedContour'];
  preservedImportRuns: string[];
  postVerification: Record<string, unknown>;
  preview: LiveCoreRecoveryPreview;
  blockerCode: RecoveryBlockerCode;
  blockerSummary: string | null;
  safeError: string | null;
};

/** Direct FK children of booking_ops_records that recovery may delete when verified. */
export const RECOVERY_ALLOWLISTED_DIRECT_CHILDREN: ReadonlyArray<{
  table: string;
  column: 'booking_id' | 'booking_ops_record_id' | 'matched_booking_id';
  pkColumn: 'id' | 'booking_id';
  relationship: string;
}> = [
  { table: 'booking_ops_events', column: 'booking_ops_record_id', pkColumn: 'id', relationship: 'direct_fk_events' },
  { table: 'booking_ops_tasks', column: 'booking_ops_record_id', pkColumn: 'id', relationship: 'direct_fk_tasks' },
  { table: 'booking_ops_worker_tasks', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_worker_tasks' },
  { table: 'booking_ops_communication_intents', column: 'booking_ops_record_id', pkColumn: 'id', relationship: 'direct_fk_intents' },
  { table: 'booking_ops_lifecycle_drafts', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_lifecycle_drafts' },
  { table: 'booking_ops_lifecycle_states', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_lifecycle_states' },
  { table: 'booking_ops_lifecycle_decisions', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_lifecycle_decisions' },
  { table: 'booking_ops_lifecycle_events', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_lifecycle_events' },
  { table: 'booking_ops_domain_events', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_domain_events' },
  { table: 'booking_ops_guest_intake_sessions', column: 'booking_ops_record_id', pkColumn: 'id', relationship: 'direct_fk_guest_intake' },
  { table: 'booking_ops_lifecycle_runs', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_lifecycle_runs' },
  { table: 'booking_ops_alerts', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_alerts' },
  { table: 'booking_availability_holds', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_holds' },
  { table: 'booking_overbooking_conflict_checks', column: 'booking_id', pkColumn: 'id', relationship: 'direct_fk_overbooking' },
  { table: 'booking_ops_telegram_drafts', column: 'booking_ops_record_id', pkColumn: 'id', relationship: 'direct_fk_telegram_drafts' },
  { table: 'booking_ops_autopilot_states', column: 'booking_id', pkColumn: 'booking_id', relationship: 'direct_fk_autopilot_states' },
] as const;

/** Full prior forensic orphan shape used by regression fixtures (synthetic IDs only). */
export const LEGACY_ORPHAN_67_ROW_SHAPE: Readonly<Record<string, number>> = {
  booking_ops_records: 1,
  booking_ops_events: 37,
  booking_ops_tasks: 10,
  booking_ops_communication_intents: 6,
  booking_ops_guest_intake_sessions: 1,
  booking_ops_lifecycle_states: 1,
  booking_ops_domain_events: 2,
  booking_ops_lifecycle_decisions: 2,
  booking_ops_lifecycle_events: 5,
  booking_ops_lifecycle_runs: 1,
  booking_ops_autopilot_states: 1,
} as const;

export const LEGACY_ORPHAN_67_ROW_TOTAL = Object.values(LEGACY_ORPHAN_67_ROW_SHAPE).reduce((sum, n) => sum + n, 0);

/** Probe tables that must remain empty for a safe legacy synthetic candidate. */
const UNSAFE_IF_PRESENT_TABLES: ReadonlyArray<{
  table: string;
  column: 'booking_id' | 'booking_ops_record_id' | 'matched_booking_id';
  blocker: RecoveryBlockerCode;
  label: string;
}> = [
  { table: 'booking_ops_communication_deliveries', column: 'booking_id', blocker: 'deliveries_present', label: 'deliveries' },
  { table: 'booking_deposits', column: 'booking_id', blocker: 'payments_present', label: 'deposits' },
  { table: 'booking_contracts', column: 'booking_id', blocker: 'payments_present', label: 'contracts' },
  { table: 'reservation_source_links', column: 'booking_ops_record_id', blocker: 'identity_mismatch', label: 'source_links' },
  // SET NULL on parent delete is still a mutation — presence blocks cleanup.
  {
    table: 'booking_channel_imported_bookings',
    column: 'matched_booking_id',
    blocker: 'unknown_fk_descendant',
    label: 'imported bookings (SET NULL)',
  },
];

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist|does not exist/i.test(error.message ?? '');
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || /column .* does not exist/i.test(error.message ?? '');
}

function hasHarnessMarker(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS;
}

function isEmptyMetadata(metadata: unknown): boolean {
  if (metadata == null) return true;
  if (typeof metadata !== 'object') return false;
  return Object.keys(metadata as Record<string, unknown>).length === 0;
}

function emptyPreview(partial: Partial<LiveCoreRecoveryPreview> = {}): LiveCoreRecoveryPreview {
  return {
    recoveryRequired: false,
    safeToCleanup: false,
    blockerCode: 'already_clean',
    blockerSummary: null,
    mainRecord: null,
    descendantManifest: [],
    countsByTable: {},
    exactIdsByTable: {},
    preservedContour: {
      ownerSetupId: null,
      propertySetupId: null,
      connectionId: null,
    },
    importRunIds: [],
    expectedDeletionTotal: 0,
    evidence: {},
    ...partial,
  };
}

async function selectKeys(
  table: string,
  fkColumn: string,
  fkValue: string,
  pkColumn: string,
): Promise<{ keys: string[]; error: string | null; missing?: boolean }> {
  const { data, error } = await supabase.from(table).select(pkColumn).eq(fkColumn, fkValue);
  if (error) {
    // Fail closed: missing relation/column is a blocker for preview safety, not silent success.
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return { keys: [], error: `${table}.${fkColumn}/${pkColumn}: ${error.message}` };
    }
    return { keys: [], error: `${table}: ${error.message}` };
  }
  return {
    keys: (data ?? []).map((row) => String((row as unknown as Record<string, unknown>)[pkColumn])),
    error: null,
  };
}

async function loadPreservedContour(): Promise<LiveCoreRecoveryPreview['preservedContour'] & {
  importRunIds: string[];
  failedImportRuns: Array<{
    id: string;
    createdAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
}> {
  const property = await supabase
    .from('booking_property_setup_profiles')
    .select('id,owner_setup_id,property_id,metadata')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })
    .maybeSingle();

  const propertySetupId = property.data?.id ? String(property.data.id) : null;
  const ownerSetupId = property.data?.owner_setup_id ? String(property.data.owner_setup_id) : null;

  const connection = propertySetupId
    ? await supabase
      .from('booking_channel_manager_connections')
      .select('id,metadata')
      .eq('property_setup_id', propertySetupId)
      .contains('metadata', { acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })
      .maybeSingle()
    : { data: null, error: null };

  const connectionId = connection.data?.id ? String(connection.data.id) : null;
  const runs = connectionId
    ? await supabase
      .from('booking_channel_import_runs')
      .select('id,status,import_type,created_at,started_at,finished_at')
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: false })
      .limit(20)
    : { data: [] as Array<Record<string, unknown>>, error: null };

  const importRunIds = (runs.data ?? []).map((row) => String(row.id));
  const failedImportRuns = (runs.data ?? [])
    .filter((row) => String(row.status) === 'failed')
    .map((row) => ({
      id: String(row.id),
      createdAt: row.created_at ? String(row.created_at) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
    }));

  return {
    ownerSetupId,
    propertySetupId,
    connectionId,
    importRunIds,
    failedImportRuns,
  };
}

function correlateOrphanToFailedImportRun(
  orphanCreatedAt: string | null,
  failedImportRuns: Array<{
    id: string;
    createdAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>,
): {
  matched: boolean;
  importRunId: string | null;
  deltaMs: number | null;
  window: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
} {
  const orphanMs = orphanCreatedAt ? Date.parse(orphanCreatedAt) : Number.NaN;
  if (!Number.isFinite(orphanMs)) {
    return {
      matched: false,
      importRunId: null,
      deltaMs: null,
      window: null,
      evidence: { orphanCreatedAt, reason: 'orphan_created_at_unparseable' },
    };
  }

  let best: {
    importRunId: string;
    deltaMs: number;
    window: Record<string, unknown>;
  } | null = null;

  for (const run of failedImportRuns) {
    const createdMs = run.createdAt ? Date.parse(run.createdAt) : Number.NaN;
    const startedMs = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    const finishedMs = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
    const anchors = [createdMs, startedMs].filter((value) => Number.isFinite(value));
    if (anchors.length === 0) continue;

    const lowerAnchor = Math.min(...anchors);
    const upperAnchor = Math.max(
      ...[finishedMs, startedMs, createdMs].filter((value) => Number.isFinite(value)),
    );
    const windowStart = lowerAnchor - LEGACY_FAILED_RUN_CORRELATION_BEFORE_MS;
    const windowEnd = upperAnchor + LEGACY_FAILED_RUN_CORRELATION_AFTER_MS;
    if (orphanMs < windowStart || orphanMs > windowEnd) continue;

    const deltaMs = orphanMs - (Number.isFinite(startedMs) ? startedMs : createdMs);
    if (!best || Math.abs(deltaMs) < Math.abs(best.deltaMs)) {
      best = {
        importRunId: run.id,
        deltaMs,
        window: {
          start: new Date(windowStart).toISOString(),
          end: new Date(windowEnd).toISOString(),
          beforeMs: LEGACY_FAILED_RUN_CORRELATION_BEFORE_MS,
          afterMs: LEGACY_FAILED_RUN_CORRELATION_AFTER_MS,
          runCreatedAt: run.createdAt,
          runStartedAt: run.startedAt,
          runCompletedAt: run.finishedAt,
        },
      };
    }
  }

  if (!best) {
    return {
      matched: false,
      importRunId: null,
      deltaMs: null,
      window: null,
      evidence: {
        orphanCreatedAt,
        failedImportRunIds: failedImportRuns.map((run) => run.id),
        reason: 'no_matching_failed_run_window',
      },
    };
  }

  return {
    matched: true,
    importRunId: best.importRunId,
    deltaMs: best.deltaMs,
    window: best.window,
    evidence: {
      orphanCreatedAt,
      matchedImportRunId: best.importRunId,
      timeDeltaMs: best.deltaMs,
      correlationWindow: best.window,
    },
  };
}

async function classifyLegacySyntheticCandidate(row: {
  id: string;
  property_id: string | null;
  booking_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  guest_telegram: string | null;
  account_id: string | null;
  ota_source: string | null;
  reservation_metadata: Record<string, unknown> | null;
  created_at: string | null;
}, contour: Awaited<ReturnType<typeof loadPreservedContour>>): Promise<{
  classification: RecoveryRowClassification;
  blockerCode: RecoveryBlockerCode;
  blockerSummary: string | null;
  evidence: Record<string, unknown>;
}> {
  const evidence: Record<string, unknown> = {};

  if (hasHarnessMarker(row.reservation_metadata)) {
    return {
      classification: 'harness_owned',
      blockerCode: 'none',
      blockerSummary: null,
      evidence: { harnessOwned: true },
    };
  }

  if (String(row.property_id ?? '') !== LIVE_CORE_ACCEPTANCE_PROPERTY_ID
    || String(row.booking_id ?? '') !== LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID
    || String(row.guest_name ?? '') !== LIVE_CORE_ACCEPTANCE_GUEST_NAME) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'identity_mismatch',
      blockerSummary: 'Идентификаторы записи не совпадают с deterministic acceptance identity.',
      evidence,
    };
  }

  const source = String(row.ota_source ?? '');
  if (source && source !== 'channel_manager' && source !== LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'identity_mismatch',
      blockerSummary: `Неожиданный источник брони: ${source}.`,
      evidence: { otaSource: source },
    };
  }

  if (row.account_id) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'account_present',
      blockerSummary: 'У записи есть account_id — удаление заблокировано.',
      evidence: { accountIdPresent: true },
    };
  }

  if (row.guest_phone || row.guest_email || row.guest_telegram) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'contact_present',
      blockerSummary: 'У записи есть контакт гостя — удаление заблокировано.',
      evidence: {
        guestPhone: Boolean(row.guest_phone),
        guestEmail: Boolean(row.guest_email),
        guestTelegram: Boolean(row.guest_telegram),
      },
    };
  }

  if (!isEmptyMetadata(row.reservation_metadata)) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'metadata_not_empty',
      blockerSummary: 'reservation_metadata не пустой и не помечен harness — удаление заблокировано.',
      evidence: { metadataKeys: Object.keys(row.reservation_metadata ?? {}) },
    };
  }

  if (!contour.ownerSetupId || !contour.propertySetupId || !contour.connectionId) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'contour_mismatch',
      blockerSummary: 'Сохранённый acceptance contour (owner/property/connection) не найден.',
      evidence: { contour },
    };
  }

  for (const probe of UNSAFE_IF_PRESENT_TABLES) {
    const result = await selectKeys(probe.table, probe.column, row.id, 'id');
    if (result.error) {
      return {
        classification: 'unknown_unsafe',
        blockerCode: 'cleanup_failed',
        blockerSummary: result.error,
        evidence,
      };
    }
    if (result.keys.length > 0) {
      return {
        classification: 'unknown_unsafe',
        blockerCode: probe.blocker,
        blockerSummary: `Найдены ${probe.label} (${result.keys.length}) — удаление заблокировано.`,
        evidence: { [probe.table]: result.keys },
      };
    }
  }

  // Creation time must correlate with one specific failed acceptance import run.
  const correlation = correlateOrphanToFailedImportRun(row.created_at, contour.failedImportRuns);
  if (!correlation.matched) {
    return {
      classification: 'unknown_unsafe',
      blockerCode: 'identity_mismatch',
      blockerSummary: 'Время создания орфана не коррелирует с failed acceptance import run.',
      evidence: {
        ...evidence,
        ...correlation.evidence,
        legacyTimeCorrelationFailed: true,
      },
    };
  }

  return {
    classification: 'legacy_synthetic_candidate',
    blockerCode: 'none',
    blockerSummary: null,
    evidence: {
      ...evidence,
      ...correlation.evidence,
      legacySyntheticCandidate: true,
      deterministicIdentityMatched: true,
      matchedImportRunId: correlation.importRunId,
      timeDeltaMs: correlation.deltaMs,
    },
  };
}

async function collectDescendants(
  bookingOpsId: string,
  classification: RecoveryRowClassification,
): Promise<{
  manifest: RecoveryDescendantRow[];
  countsByTable: Record<string, number>;
  exactIdsByTable: Record<string, string[]>;
  unknownTables: string[];
  error: string | null;
}> {
  const manifest: RecoveryDescendantRow[] = [];
  const countsByTable: Record<string, number> = {};
  const exactIdsByTable: Record<string, string[]> = {};
  const unknownTables: string[] = [];

  for (const child of RECOVERY_ALLOWLISTED_DIRECT_CHILDREN) {
    const result = await selectKeys(child.table, child.column, bookingOpsId, child.pkColumn);
    if (result.error) return { manifest, countsByTable, exactIdsByTable, unknownTables, error: result.error };
    if (result.keys.length === 0) continue;
    exactIdsByTable[child.table] = result.keys;
    countsByTable[child.table] = result.keys.length;
    for (const id of result.keys) {
      manifest.push({
        table: child.table,
        id,
        relationship: child.relationship,
        classification,
      });
    }
  }

  // Indirect deliveries via intents — any presence is unsafe for synthetic cleanup.
  const intentIds = exactIdsByTable.booking_ops_communication_intents ?? [];
  if (intentIds.length > 0) {
    const { data, error } = await supabase
      .from('booking_ops_communication_deliveries')
      .select('id,communication_intent_id,status,sent_at')
      .in('communication_intent_id', intentIds);
    if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) {
      return { manifest, countsByTable, exactIdsByTable, unknownTables, error: error.message };
    }
    if (error && (isMissingRelationError(error) || isMissingColumnError(error))) {
      return { manifest, countsByTable, exactIdsByTable, unknownTables, error: `booking_ops_communication_deliveries: ${error.message}` };
    }
    const deliveryIds = (data ?? []).map((row) => String(row.id));
    if (deliveryIds.length > 0) {
      exactIdsByTable.booking_ops_communication_deliveries = deliveryIds;
      countsByTable.booking_ops_communication_deliveries = deliveryIds.length;
      for (const id of deliveryIds) {
        manifest.push({
          table: 'booking_ops_communication_deliveries',
          id,
          relationship: 'indirect_via_intent',
          classification: 'unknown_unsafe',
        });
      }
    }
  }

  // Live FK probe via RPC — must succeed and report no unknown/non-allowlisted children with rows.
  const fkProbe = await supabase.rpc('channel_manager_live_core_booking_ops_fk_children', {
    p_booking_ops_record_id: bookingOpsId,
  });
  if (fkProbe.error) {
    if (/function .* does not exist|Could not find the function/i.test(fkProbe.error.message)) {
      // Preview can still classify without live RPC; committed cleanup will hard-block.
      return { manifest, countsByTable, exactIdsByTable, unknownTables, error: null };
    }
    return { manifest, countsByTable, exactIdsByTable, unknownTables, error: fkProbe.error.message };
  }

  const payload = fkProbe.data as Record<string, unknown> | null;
  if (payload && typeof payload === 'object' && payload.ok === false) {
    return {
      manifest,
      countsByTable,
      exactIdsByTable,
      unknownTables,
      error: String(payload.blocker_summary ?? 'FK discovery failed'),
    };
  }

  const edges = Array.isArray((payload as { edges?: unknown })?.edges)
    ? (payload as { edges: Array<Record<string, unknown>> }).edges
    : [];
  const allowlisted = new Set(RECOVERY_ALLOWLISTED_DIRECT_CHILDREN.map((item) => item.table));
  for (const edge of edges) {
    const table = String(edge.table_name ?? '');
    const rowCount = Number(edge.row_count ?? 0);
    const deletable = edge.deletable === true;
    if (!table || rowCount <= 0) continue;
    if (!deletable || !allowlisted.has(table)) {
      unknownTables.push(table);
      const childKeys = Array.isArray(edge.child_keys) ? edge.child_keys.map(String) : [];
      exactIdsByTable[table] = [...(exactIdsByTable[table] ?? []), ...childKeys];
      countsByTable[table] = (countsByTable[table] ?? 0) + rowCount;
      for (const id of childKeys) {
        manifest.push({
          table,
          id,
          relationship: `unknown_fk:${String(edge.column_name ?? 'ref')}`,
          classification: 'unknown_unsafe',
        });
      }
    }
  }

  return { manifest, countsByTable, exactIdsByTable, unknownTables: [...new Set(unknownTables)], error: null };
}

/**
 * Read-only recovery preview for deterministic Live Core acceptance artifacts.
 */
export async function previewLiveCoreSyntheticRecovery(): Promise<LiveCoreRecoveryPreview> {
  const contour = await loadPreservedContour();

  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id,property_id,booking_id,guest_name,guest_phone,guest_email,guest_telegram,account_id,ota_source,reservation_metadata,created_at')
    .eq('property_id', LIVE_CORE_ACCEPTANCE_PROPERTY_ID)
    .eq('booking_id', LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID);

  if (error) {
    return emptyPreview({
      recoveryRequired: true,
      safeToCleanup: false,
      blockerCode: 'cleanup_failed',
      blockerSummary: error.message,
      preservedContour: {
        ownerSetupId: contour.ownerSetupId,
        propertySetupId: contour.propertySetupId,
        connectionId: contour.connectionId,
      },
      importRunIds: contour.importRunIds,
    });
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return emptyPreview({
      recoveryRequired: false,
      safeToCleanup: false,
      blockerCode: 'already_clean',
      blockerSummary: 'Синтетические Booking Ops артефакты не найдены — контур чист.',
      preservedContour: {
        ownerSetupId: contour.ownerSetupId,
        propertySetupId: contour.propertySetupId,
        connectionId: contour.connectionId,
      },
      importRunIds: contour.importRunIds,
    });
  }

  if (rows.length > 1) {
    return emptyPreview({
      recoveryRequired: true,
      safeToCleanup: false,
      blockerCode: 'ambiguous_candidate',
      blockerSummary: `Найдено ${rows.length} кандидатов с deterministic identity — удаление заблокировано.`,
      preservedContour: {
        ownerSetupId: contour.ownerSetupId,
        propertySetupId: contour.propertySetupId,
        connectionId: contour.connectionId,
      },
      importRunIds: contour.importRunIds,
      evidence: { candidateIds: rows.map((row) => String(row.id)) },
    });
  }

  const row = rows[0] as {
    id: string;
    property_id: string | null;
    booking_id: string | null;
    guest_name: string | null;
    guest_phone: string | null;
    guest_email: string | null;
    guest_telegram: string | null;
    account_id: string | null;
    ota_source: string | null;
    reservation_metadata: Record<string, unknown> | null;
    created_at: string | null;
  };

  const classified = await classifyLegacySyntheticCandidate(row, contour);
  const descendants = await collectDescendants(String(row.id), classified.classification);
  if (descendants.error) {
    return emptyPreview({
      recoveryRequired: true,
      safeToCleanup: false,
      blockerCode: 'cleanup_failed',
      blockerSummary: descendants.error,
      mainRecord: {
        id: String(row.id),
        propertyId: row.property_id,
        bookingId: row.booking_id,
        guestName: row.guest_name,
        accountId: row.account_id,
        otaSource: row.ota_source,
        reservationMetadata: row.reservation_metadata ?? {},
        classification: classified.classification,
        createdAt: row.created_at,
      },
      preservedContour: {
        ownerSetupId: contour.ownerSetupId,
        propertySetupId: contour.propertySetupId,
        connectionId: contour.connectionId,
      },
      importRunIds: contour.importRunIds,
    });
  }

  let blockerCode = classified.blockerCode;
  let blockerSummary = classified.blockerSummary;
  let safeToCleanup = classified.classification !== 'unknown_unsafe' && blockerCode === 'none';

  if (descendants.unknownTables.length > 0) {
    safeToCleanup = false;
    blockerCode = 'unknown_fk_descendant';
    blockerSummary = `Обнаружены неизвестные FK-потомки: ${descendants.unknownTables.join(', ')}.`;
  }

  if ((descendants.exactIdsByTable.booking_ops_communication_deliveries ?? []).length > 0) {
    safeToCleanup = false;
    blockerCode = 'deliveries_present';
    blockerSummary = 'Найдены communication deliveries — удаление заблокировано.';
  }

  const exactIdsByTable = {
    ...descendants.exactIdsByTable,
    booking_ops_records: [String(row.id)],
  };
  const countsByTable = {
    ...descendants.countsByTable,
    booking_ops_records: 1,
  };
  const expectedDeletionTotal = Object.values(countsByTable).reduce((sum, count) => sum + count, 0);

  return {
    recoveryRequired: true,
    safeToCleanup,
    blockerCode: safeToCleanup ? 'none' : blockerCode,
    blockerSummary: safeToCleanup ? null : blockerSummary,
    mainRecord: {
      id: String(row.id),
      propertyId: row.property_id,
      bookingId: row.booking_id,
      guestName: row.guest_name,
      accountId: row.account_id,
      otaSource: row.ota_source,
      reservationMetadata: row.reservation_metadata ?? {},
      classification: classified.classification,
      createdAt: row.created_at,
    },
    descendantManifest: descendants.manifest,
    countsByTable,
    exactIdsByTable,
    preservedContour: {
      ownerSetupId: contour.ownerSetupId,
      propertySetupId: contour.propertySetupId,
      connectionId: contour.connectionId,
    },
    importRunIds: contour.importRunIds,
    expectedDeletionTotal,
    evidence: classified.evidence,
  };
}

function blockedCleanup(
  preview: LiveCoreRecoveryPreview,
  dryRun: boolean,
  blockerCode: RecoveryBlockerCode,
  blockerSummary: string,
  status: LiveCoreRecoveryCleanupResult['status'] = 'blocked',
): LiveCoreRecoveryCleanupResult {
  return {
    status,
    transactionCommitted: false,
    dryRun,
    deletedCountsByTable: {},
    preservedContour: preview.preservedContour,
    preservedImportRuns: preview.importRunIds,
    postVerification: {},
    preview,
    blockerCode,
    blockerSummary,
    safeError: blockerSummary,
  };
}

/**
 * Transactional cleanup of verified synthetic Live Core acceptance artifacts.
 * Dry-run by default. Requires exact confirmation phrase for commit.
 */
export async function cleanupLiveCoreSyntheticRecovery(input: {
  confirmPhrase?: string | null;
  dryRun?: boolean;
  expectedBookingOpsRecordId?: string | null;
  expectedPreviewFingerprint?: string | null;
} = {}): Promise<LiveCoreRecoveryCleanupResult> {
  const dryRun = input.dryRun !== false;
  const preview = await previewLiveCoreSyntheticRecovery();

  if (preview.blockerCode === 'already_clean' || !preview.recoveryRequired) {
    return {
      status: 'already_clean',
      transactionCommitted: false,
      dryRun,
      deletedCountsByTable: {},
      preservedContour: preview.preservedContour,
      preservedImportRuns: preview.importRunIds,
      postVerification: { deterministicIdentityGone: true, descendantsRemain: false },
      preview,
      blockerCode: 'already_clean',
      blockerSummary: preview.blockerSummary,
      safeError: null,
    };
  }

  if (!preview.safeToCleanup || !preview.mainRecord) {
    return blockedCleanup(
      preview,
      dryRun,
      preview.blockerCode === 'none' ? 'cleanup_failed' : preview.blockerCode,
      preview.blockerSummary ?? 'Cleanup заблокирован safety checks.',
    );
  }

  if (
    input.expectedBookingOpsRecordId
    && input.expectedBookingOpsRecordId !== preview.mainRecord.id
  ) {
    return blockedCleanup(
      preview,
      dryRun,
      'row_changed',
      'ID кандидата изменился между preview и cleanup.',
    );
  }

  if (!dryRun) {
    if (!input.confirmPhrase) {
      return blockedCleanup(preview, dryRun, 'confirmation_required', 'Нужна точная фраза подтверждения cleanup.');
    }
    if (input.confirmPhrase !== LIVE_CORE_RECOVERY_CONFIRM_PHRASE) {
      return blockedCleanup(preview, dryRun, 'confirmation_mismatch', 'Фраза подтверждения не совпадает.');
    }
  }

  const deletionManifest: Record<string, string[]> = { ...preview.exactIdsByTable };
  const rpcPayload = {
    p_confirm: dryRun ? 'DRY_RUN' : LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
    p_dry_run: dryRun,
    p_booking_ops_record_id: preview.mainRecord.id,
    p_expected_property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
    p_expected_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
    p_expected_guest_name: LIVE_CORE_ACCEPTANCE_GUEST_NAME,
    p_deletion_manifest: deletionManifest,
    p_preserve_owner_setup_id: preview.preservedContour.ownerSetupId,
    p_preserve_property_setup_id: preview.preservedContour.propertySetupId,
    p_preserve_connection_id: preview.preservedContour.connectionId,
    p_preserve_import_run_ids: preview.importRunIds,
  };

  const { data, error } = await supabase.rpc(
    'channel_manager_live_core_synthetic_recovery_cleanup',
    rpcPayload,
  );

  if (error) {
    // Missing migration/RPC must never downgrade into partial REST deletes.
    if (/function .* does not exist|Could not find the function/i.test(error.message)) {
      if (dryRun) {
        return {
          status: 'passed',
          transactionCommitted: false,
          dryRun: true,
          deletedCountsByTable: Object.fromEntries(
            Object.entries(deletionManifest).map(([table, ids]) => [table, ids.length]),
          ),
          preservedContour: preview.preservedContour,
          preservedImportRuns: preview.importRunIds,
          postVerification: { dryRun: true, schemaRpcUnavailable: true },
          preview,
          blockerCode: 'none',
          blockerSummary: null,
          safeError: null,
        };
      }
      return blockedCleanup(
        preview,
        dryRun,
        'schema_rpc_unavailable',
        'Transactional recovery RPC недоступен — committed cleanup заблокирован. Partial REST cleanup запрещён.',
      );
    }
    return {
      status: 'failed',
      transactionCommitted: false,
      dryRun,
      deletedCountsByTable: {},
      preservedContour: preview.preservedContour,
      preservedImportRuns: preview.importRunIds,
      postVerification: {},
      preview,
      blockerCode: 'cleanup_failed',
      blockerSummary: 'Transactional cleanup не выполнен.',
      safeError: error.message.slice(0, 240),
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const statusRaw = String(result.status ?? 'failed');
  const status = (
    statusRaw === 'passed' || statusRaw === 'blocked' || statusRaw === 'failed' || statusRaw === 'already_clean'
      ? statusRaw
      : 'failed'
  ) as LiveCoreRecoveryCleanupResult['status'];

  return {
    status,
    transactionCommitted: result.transaction_committed === true,
    dryRun,
    deletedCountsByTable: (result.deleted_counts_by_table as Record<string, number>) ?? {},
    preservedContour: preview.preservedContour,
    preservedImportRuns: preview.importRunIds,
    postVerification: (result.post_verification as Record<string, unknown>) ?? {},
    preview,
    blockerCode: (result.blocker_code as RecoveryBlockerCode) ?? (status === 'passed' ? 'none' : 'cleanup_failed'),
    blockerSummary: (result.blocker_summary as string | null) ?? null,
    safeError: (result.safe_error as string | null) ?? null,
  };
}
