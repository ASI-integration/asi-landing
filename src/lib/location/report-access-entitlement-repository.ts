import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  createReportAccessEntitlement,
  isReportAccessEntitlementEffective,
  normalizeReportAccessEntitlementRow,
  REPORT_ACCESS_ENTITLEMENT_STATUS,
  type CreateReportAccessEntitlementInput,
  type ReportAccessEntitlement,
  type ReportAccessEntitlementMetadata,
  type ReportAccessSubjectType,
} from './report-access-entitlement';

export type ReportAccessEntitlementRepository = {
  createEntitlement(input: CreateReportAccessEntitlementInput): Promise<ReportAccessEntitlement>;
  getEntitlementsByRequestId(requestId: string): Promise<ReportAccessEntitlement[]>;
  getActiveEntitlements(
    requestId: string,
    options?: {
      subjectType?: ReportAccessSubjectType;
      subjectId?: string;
      now?: Date;
    },
  ): Promise<ReportAccessEntitlement[]>;
  revokeEntitlement(
    entitlementId: string,
    patch?: { metadata?: ReportAccessEntitlementMetadata },
  ): Promise<ReportAccessEntitlement>;
};

type SupabaseEntitlementClient = Pick<SupabaseClient, 'from'>;

const ENTITLEMENT_TABLE = 'location_report_access_entitlements';
const ENTITLEMENT_COLUMNS = [
  'entitlement_id',
  'request_id',
  'report_id',
  'snapshot_id',
  'subject_type',
  'subject_id',
  'access_level',
  'status',
  'expires_at',
  'created_at',
  'updated_at',
  'metadata',
].join(', ');

function nowIso(): string {
  return new Date().toISOString();
}

export class SupabaseReportAccessEntitlementRepository implements ReportAccessEntitlementRepository {
  constructor(private readonly client: SupabaseEntitlementClient = supabase) {}

  async createEntitlement(input: CreateReportAccessEntitlementInput): Promise<ReportAccessEntitlement> {
    const entitlement = createReportAccessEntitlement(input);
    const { data, error } = await this.client
      .from(ENTITLEMENT_TABLE)
      .insert(entitlement)
      .select(ENTITLEMENT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_create_report_access_entitlement');
    return normalizeReportAccessEntitlementRow(data);
  }

  async getEntitlementsByRequestId(requestId: string): Promise<ReportAccessEntitlement[]> {
    const { data, error } = await this.client
      .from(ENTITLEMENT_TABLE)
      .select(ENTITLEMENT_COLUMNS)
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportAccessEntitlementRow);
  }

  async getActiveEntitlements(
    requestId: string,
    options: {
      subjectType?: ReportAccessSubjectType;
      subjectId?: string;
      now?: Date;
    } = {},
  ): Promise<ReportAccessEntitlement[]> {
    const entitlements = await this.getEntitlementsByRequestId(requestId);
    const now = options.now ?? new Date();
    return entitlements.filter(entitlement => {
      if (options.subjectType && entitlement.subject_type !== options.subjectType) return false;
      if (options.subjectId && entitlement.subject_id !== options.subjectId) return false;
      return isReportAccessEntitlementEffective(entitlement, now);
    });
  }

  async revokeEntitlement(
    entitlementId: string,
    patch: { metadata?: ReportAccessEntitlementMetadata } = {},
  ): Promise<ReportAccessEntitlement> {
    const updatedAt = nowIso();
    const { data, error } = await this.client
      .from(ENTITLEMENT_TABLE)
      .update({
        status: REPORT_ACCESS_ENTITLEMENT_STATUS.revoked,
        updated_at: updatedAt,
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      })
      .eq('entitlement_id', entitlementId)
      .select(ENTITLEMENT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_revoke_report_access_entitlement');
    return normalizeReportAccessEntitlementRow(data);
  }
}

export const reportAccessEntitlementRepository = new SupabaseReportAccessEntitlementRepository();

export async function createPlannedReportAccessEntitlements(
  planned: CreateReportAccessEntitlementInput[],
  repository: ReportAccessEntitlementRepository = reportAccessEntitlementRepository,
): Promise<ReportAccessEntitlement[]> {
  const created: ReportAccessEntitlement[] = [];
  for (const input of planned) {
    created.push(await repository.createEntitlement(input));
  }
  return created;
}
