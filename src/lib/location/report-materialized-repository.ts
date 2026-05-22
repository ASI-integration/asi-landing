import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  buildMaterializedReport,
  isMaterializedReportTarget,
  normalizeMaterializedReportStatus,
  MATERIALIZED_REPORT_STATUS,
  type GetMaterializedReportQuery,
  type ListMaterializedReportsOptions,
  type MaterializedReport,
  type MaterializedReportMetadata,
  type MaterializedReportPayload,
  type UpsertMaterializedReportInput,
} from './report-materialized';

export type MaterializedReportRepository = {
  getMaterializedReport(query: GetMaterializedReportQuery): Promise<MaterializedReport | null>;
  upsertMaterializedReport(input: UpsertMaterializedReportInput): Promise<MaterializedReport>;
  markMaterializedStale(
    snapshotId: string,
    options?: { target?: MaterializedReport['target']; materializedIds?: string[] },
  ): Promise<MaterializedReport[]>;
  listMaterializedReports(options: ListMaterializedReportsOptions): Promise<MaterializedReport[]>;
};

type SupabaseMaterializedClient = Pick<SupabaseClient, 'from'>;

const MATERIALIZED_TABLE = 'location_report_materialized';
const MATERIALIZED_COLUMNS = [
  'materialized_id',
  'snapshot_id',
  'report_id',
  'target',
  'version',
  'status',
  'created_at',
  'updated_at',
  'expires_at',
  'payload',
  'metadata',
].join(', ');

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMaterializedMetadata(value: unknown): MaterializedReportMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as MaterializedReportMetadata;
}

function normalizeMaterializedRow(row: unknown): MaterializedReport {
  const record = row as Partial<MaterializedReport> & {
    materialized_id: string;
    snapshot_id: string;
    target: string;
    version: number;
    payload: MaterializedReportPayload;
  };

  if (!isMaterializedReportTarget(record.target)) {
    throw new Error('invalid_materialized_report_target');
  }

  return {
    materialized_id: record.materialized_id,
    snapshot_id: record.snapshot_id,
    report_id: record.report_id ?? null,
    target: record.target,
    version: record.version,
    status: normalizeMaterializedReportStatus(record.status),
    created_at: record.created_at ?? nowIso(),
    updated_at: record.updated_at ?? nowIso(),
    expires_at: record.expires_at ?? null,
    payload: record.payload,
    metadata: normalizeMaterializedMetadata(record.metadata),
  };
}

export class SupabaseMaterializedReportRepository implements MaterializedReportRepository {
  constructor(private readonly client: SupabaseMaterializedClient = supabase) {}

  async getMaterializedReport(query: GetMaterializedReportQuery): Promise<MaterializedReport | null> {
    const { data, error } = await this.client
      .from(MATERIALIZED_TABLE)
      .select(MATERIALIZED_COLUMNS)
      .eq('snapshot_id', query.snapshot_id)
      .eq('target', query.target)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? normalizeMaterializedRow(data) : null;
  }

  async upsertMaterializedReport(input: UpsertMaterializedReportInput): Promise<MaterializedReport> {
    const existing = await this.getMaterializedReport({
      snapshot_id: input.snapshot_id,
      target: input.target,
    });
    const updatedAt = input.updated_at ?? nowIso();
    const next = buildMaterializedReport({
      ...input,
      materialized_id: existing?.materialized_id ?? input.materialized_id,
      created_at: existing?.created_at ?? input.created_at ?? updatedAt,
      updated_at: updatedAt,
      status: input.status ?? MATERIALIZED_REPORT_STATUS.ready,
    });

    const { data, error } = await this.client
      .from(MATERIALIZED_TABLE)
      .upsert(next, { onConflict: 'snapshot_id,target' })
      .select(MATERIALIZED_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_upsert_materialized_report');
    return normalizeMaterializedRow(data);
  }

  async markMaterializedStale(
    snapshotId: string,
    options: { target?: MaterializedReport['target']; materializedIds?: string[] } = {},
  ): Promise<MaterializedReport[]> {
    const updatedAt = nowIso();
    let query = this.client
      .from(MATERIALIZED_TABLE)
      .update({
        status: MATERIALIZED_REPORT_STATUS.stale,
        updated_at: updatedAt,
      })
      .eq('snapshot_id', snapshotId)
      .eq('status', MATERIALIZED_REPORT_STATUS.ready)
      .select(MATERIALIZED_COLUMNS);

    if (options.target) {
      query = query.eq('target', options.target);
    }
    if (options.materializedIds?.length) {
      query = query.in('materialized_id', options.materializedIds);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeMaterializedRow);
  }

  async listMaterializedReports(
    options: ListMaterializedReportsOptions = {},
  ): Promise<MaterializedReport[]> {
    let query = this.client
      .from(MATERIALIZED_TABLE)
      .select(MATERIALIZED_COLUMNS)
      .order('updated_at', { ascending: false });

    if (options.snapshot_id) {
      query = query.eq('snapshot_id', options.snapshot_id);
    }
    if (options.report_id) {
      query = query.eq('report_id', options.report_id);
    }
    if (options.target) {
      query = query.eq('target', options.target);
    }
    if (options.status) {
      query = query.eq('status', options.status);
    }
    if (typeof options.limit === 'number') {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeMaterializedRow);
  }
}

export const reportMaterializedRepository = new SupabaseMaterializedReportRepository();
