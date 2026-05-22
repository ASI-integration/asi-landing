import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isCanonicalReportDocument } from './canonical-report-document';
import type { CanonicalReportRenderOutputsMetadata } from './report-artifact';
import {
  buildReportSnapshot,
  normalizeReportSnapshotStatus,
  type CreateReportSnapshotInput,
  type ReportSnapshot,
  type ReportSnapshotMetadata,
  type ReportSnapshotStatus,
} from './report-snapshot';
import type { CanonicalReportLayer } from './canonical-report-document';
import type { CanonicalReportSourceSummary } from './canonical-report-document';

export type ReportSnapshotListOptions = {
  reportLayer?: CanonicalReportLayer;
  limit?: number;
};

export type ReportSnapshotLatestOptions = {
  reportLayer?: CanonicalReportLayer;
};

export type ReportSnapshotRepository = {
  createSnapshot(input: CreateReportSnapshotInput): Promise<ReportSnapshot>;
  getLatestSnapshot(requestId: string, options?: ReportSnapshotLatestOptions): Promise<ReportSnapshot | null>;
  listSnapshots(requestId: string, options?: ReportSnapshotListOptions): Promise<ReportSnapshot[]>;
};

type SupabaseSnapshotClient = Pick<SupabaseClient, 'from'>;

const SNAPSHOT_TABLE = 'location_report_snapshots';
const SNAPSHOT_COLUMNS = [
  'snapshot_id',
  'report_id',
  'request_id',
  'version',
  'status',
  'created_at',
  'generated_at',
  'report_layer',
  'canonical_document',
  'render_outputs',
  'source_summary',
  'metadata',
].join(', ');

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSnapshotMetadata(value: unknown): ReportSnapshotMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ReportSnapshotMetadata;
}

function normalizeRenderOutputs(value: unknown): CanonicalReportRenderOutputsMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CanonicalReportRenderOutputsMetadata;
}

function normalizeSourceSummary(value: unknown): CanonicalReportSourceSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CanonicalReportSourceSummary;
}

function normalizeSnapshotRow(row: unknown): ReportSnapshot {
  const snapshot = row as Partial<ReportSnapshot> & {
    snapshot_id: string;
    request_id: string;
    version: number;
  };
  const canonical_document = snapshot.canonical_document;
  if (!isCanonicalReportDocument(canonical_document)) {
    throw new Error('invalid_snapshot_canonical_document');
  }

  const source_summary = normalizeSourceSummary(snapshot.source_summary) ?? canonical_document.source_summary;
  return {
    snapshot_id: snapshot.snapshot_id,
    report_id: snapshot.report_id ?? null,
    request_id: snapshot.request_id,
    version: snapshot.version,
    status: normalizeReportSnapshotStatus(snapshot.status),
    created_at: snapshot.created_at ?? nowIso(),
    generated_at: snapshot.generated_at ?? null,
    report_layer: snapshot.report_layer ?? canonical_document.report_layer,
    canonical_document,
    render_outputs: normalizeRenderOutputs(snapshot.render_outputs),
    source_summary,
    metadata: normalizeSnapshotMetadata(snapshot.metadata),
  };
}

export class SupabaseReportSnapshotRepository implements ReportSnapshotRepository {
  constructor(private readonly client: SupabaseSnapshotClient = supabase) {}

  private async resolveNextVersion(requestId: string): Promise<number> {
    const { data, error } = await this.client
      .from(SNAPSHOT_TABLE)
      .select('version')
      .eq('request_id', requestId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return typeof data?.version === 'number' ? data.version + 1 : 1;
  }

  async createSnapshot(input: CreateReportSnapshotInput): Promise<ReportSnapshot> {
    const version = input.version ?? await this.resolveNextVersion(input.request_id);
    const snapshot = buildReportSnapshot({
      ...input,
      version,
      created_at: input.created_at ?? nowIso(),
    });

    const { data, error } = await this.client
      .from(SNAPSHOT_TABLE)
      .insert(snapshot)
      .select(SNAPSHOT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_create_report_snapshot');
    return normalizeSnapshotRow(data);
  }

  async getLatestSnapshot(
    requestId: string,
    options: ReportSnapshotLatestOptions = {},
  ): Promise<ReportSnapshot | null> {
    let query = this.client
      .from(SNAPSHOT_TABLE)
      .select(SNAPSHOT_COLUMNS)
      .eq('request_id', requestId)
      .order('version', { ascending: false })
      .limit(1);

    if (options.reportLayer) {
      query = query.eq('report_layer', options.reportLayer);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data ? normalizeSnapshotRow(data) : null;
  }

  async listSnapshots(
    requestId: string,
    options: ReportSnapshotListOptions = {},
  ): Promise<ReportSnapshot[]> {
    let query = this.client
      .from(SNAPSHOT_TABLE)
      .select(SNAPSHOT_COLUMNS)
      .eq('request_id', requestId)
      .order('version', { ascending: false });

    if (options.reportLayer) {
      query = query.eq('report_layer', options.reportLayer);
    }
    if (typeof options.limit === 'number') {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeSnapshotRow);
  }
}

export const reportSnapshotRepository = new SupabaseReportSnapshotRepository();
