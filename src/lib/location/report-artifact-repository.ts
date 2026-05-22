import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  createReportArtifact,
  normalizeReportArtifactStatus,
  type ReportArtifact,
  type ReportArtifactMetadata,
  type ReportArtifactStatus,
} from './report-artifact';

export type ReportArtifactPatch = Partial<
  Pick<
    ReportArtifact,
    | 'preliminary_report_url'
    | 'final_report_url'
    | 'pdf_url'
    | 'generated_at'
    | 'expires_at'
    | 'cleanup_ready'
    | 'metadata'
  >
> & {
  status?: ReportArtifactStatus;
  created_at?: string;
  updated_at?: string;
};

export type ReportArtifactRepository = {
  getByRequestId(requestId: string): Promise<ReportArtifact | null>;
  upsert(requestId: string, patch: ReportArtifactPatch): Promise<ReportArtifact>;
};

type SupabaseArtifactClient = Pick<SupabaseClient, 'from'>;

const ARTIFACT_TABLE = 'location_report_artifacts';
const ARTIFACT_COLUMNS = [
  'request_id',
  'status',
  'preliminary_report_url',
  'final_report_url',
  'pdf_url',
  'generated_at',
  'expires_at',
  'cleanup_ready',
  'metadata',
  'created_at',
  'updated_at',
].join(', ');

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeArtifactMetadata(value: unknown): ReportArtifactMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ReportArtifactMetadata;
}

function normalizeArtifactRow(row: unknown): ReportArtifact {
  const artifact = row as Partial<ReportArtifact> & { request_id: string };
  const timestamp = artifact.updated_at ?? artifact.created_at ?? nowIso();
  return {
    request_id: artifact.request_id,
    status: normalizeReportArtifactStatus(artifact.status),
    preliminary_report_url: artifact.preliminary_report_url ?? null,
    final_report_url: artifact.final_report_url ?? null,
    pdf_url: artifact.pdf_url ?? null,
    generated_at: artifact.generated_at ?? null,
    expires_at: artifact.expires_at ?? null,
    cleanup_ready: artifact.cleanup_ready ?? false,
    metadata: normalizeArtifactMetadata(artifact.metadata),
    created_at: artifact.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

export class SupabaseReportArtifactRepository implements ReportArtifactRepository {
  constructor(private readonly client: SupabaseArtifactClient = supabase) {}

  async getByRequestId(requestId: string): Promise<ReportArtifact | null> {
    const { data, error } = await this.client
      .from(ARTIFACT_TABLE)
      .select(ARTIFACT_COLUMNS)
      .eq('request_id', requestId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? normalizeArtifactRow(data) : null;
  }

  async upsert(requestId: string, patch: ReportArtifactPatch): Promise<ReportArtifact> {
    const existing = await this.getByRequestId(requestId);
    const updatedAt = patch.updated_at ?? nowIso();
    const base = existing ?? createReportArtifact({
      requestId,
      status: patch.status,
      now: patch.created_at ?? updatedAt,
    });
    const next: ReportArtifact = {
      ...base,
      ...patch,
      request_id: requestId,
      status: normalizeReportArtifactStatus(patch.status, base.status),
      cleanup_ready: patch.cleanup_ready ?? base.cleanup_ready,
      expires_at: patch.expires_at ?? base.expires_at,
      metadata: patch.metadata ?? base.metadata,
      created_at: base.created_at,
      updated_at: updatedAt,
    };

    const { data, error } = await this.client
      .from(ARTIFACT_TABLE)
      .upsert(next, { onConflict: 'request_id' })
      .select(ARTIFACT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_upsert_report_artifact');
    return normalizeArtifactRow(data);
  }
}

export const reportArtifactRepository = new SupabaseReportArtifactRepository();
