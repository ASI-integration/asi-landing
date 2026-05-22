import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  createReportAuditEvent,
  normalizeReportAuditEventRow,
  type CreateReportAuditEventInput,
  type ReportAuditEvent,
} from './report-audit-event';

export type ReportAuditRepository = {
  createAuditEvent(input: CreateReportAuditEventInput): Promise<ReportAuditEvent>;
  listAuditEventsByRequestId(requestId: string): Promise<ReportAuditEvent[]>;
  listAuditEventsByReportId(reportId: string): Promise<ReportAuditEvent[]>;
  listAuditEventsBySnapshotId(snapshotId: string): Promise<ReportAuditEvent[]>;
};

type SupabaseAuditClient = Pick<SupabaseClient, 'from'>;

const AUDIT_TABLE = 'location_report_audit_events';
const AUDIT_COLUMNS = [
  'event_id',
  'request_id',
  'report_id',
  'snapshot_id',
  'event_type',
  'layer',
  'status',
  'message',
  'created_at',
  'metadata',
].join(', ');

export class SupabaseReportAuditRepository implements ReportAuditRepository {
  constructor(private readonly client: SupabaseAuditClient = supabase) {}

  async createAuditEvent(input: CreateReportAuditEventInput): Promise<ReportAuditEvent> {
    const event = createReportAuditEvent(input);
    const { data, error } = await this.client
      .from(AUDIT_TABLE)
      .insert(event)
      .select(AUDIT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_create_report_audit_event');
    return normalizeReportAuditEventRow(data);
  }

  async listAuditEventsByRequestId(requestId: string): Promise<ReportAuditEvent[]> {
    const { data, error } = await this.client
      .from(AUDIT_TABLE)
      .select(AUDIT_COLUMNS)
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportAuditEventRow);
  }

  async listAuditEventsByReportId(reportId: string): Promise<ReportAuditEvent[]> {
    const { data, error } = await this.client
      .from(AUDIT_TABLE)
      .select(AUDIT_COLUMNS)
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportAuditEventRow);
  }

  async listAuditEventsBySnapshotId(snapshotId: string): Promise<ReportAuditEvent[]> {
    const { data, error } = await this.client
      .from(AUDIT_TABLE)
      .select(AUDIT_COLUMNS)
      .eq('snapshot_id', snapshotId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportAuditEventRow);
  }
}

export const reportAuditRepository = new SupabaseReportAuditRepository();
