import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  createReportDelivery,
  normalizeReportDeliveryRow,
  normalizeReportDeliveryStatus,
  type CreateReportDeliveryInput,
  type ReportDelivery,
  type ReportDeliveryMetadata,
  type ReportDeliveryStatus,
} from './report-delivery';

export type ReportDeliveryRepository = {
  createDelivery(input: CreateReportDeliveryInput): Promise<ReportDelivery>;
  updateDeliveryStatus(
    deliveryId: string,
    status: ReportDeliveryStatus,
    patch?: {
      delivered_at?: string | null;
      metadata?: ReportDeliveryMetadata;
    },
  ): Promise<ReportDelivery>;
  getDeliveriesByRequestId(requestId: string): Promise<ReportDelivery[]>;
  getDeliveriesBySnapshotId(snapshotId: string): Promise<ReportDelivery[]>;
};

type SupabaseDeliveryClient = Pick<SupabaseClient, 'from'>;

const DELIVERY_TABLE = 'location_report_deliveries';
const DELIVERY_COLUMNS = [
  'delivery_id',
  'request_id',
  'snapshot_id',
  'channel',
  'status',
  'target',
  'created_at',
  'updated_at',
  'delivered_at',
  'metadata',
].join(', ');

function nowIso(): string {
  return new Date().toISOString();
}

export class SupabaseReportDeliveryRepository implements ReportDeliveryRepository {
  constructor(private readonly client: SupabaseDeliveryClient = supabase) {}

  async createDelivery(input: CreateReportDeliveryInput): Promise<ReportDelivery> {
    const delivery = createReportDelivery(input);
    const { data, error } = await this.client
      .from(DELIVERY_TABLE)
      .insert(delivery)
      .select(DELIVERY_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_create_report_delivery');
    return normalizeReportDeliveryRow(data);
  }

  async updateDeliveryStatus(
    deliveryId: string,
    status: ReportDeliveryStatus,
    patch: {
      delivered_at?: string | null;
      metadata?: ReportDeliveryMetadata;
    } = {},
  ): Promise<ReportDelivery> {
    const updatedAt = nowIso();
    const { data, error } = await this.client
      .from(DELIVERY_TABLE)
      .update({
        status: normalizeReportDeliveryStatus(status),
        updated_at: updatedAt,
        ...(patch.delivered_at !== undefined ? { delivered_at: patch.delivered_at } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      })
      .eq('delivery_id', deliveryId)
      .select(DELIVERY_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('failed_to_update_report_delivery');
    return normalizeReportDeliveryRow(data);
  }

  async getDeliveriesByRequestId(requestId: string): Promise<ReportDelivery[]> {
    const { data, error } = await this.client
      .from(DELIVERY_TABLE)
      .select(DELIVERY_COLUMNS)
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportDeliveryRow);
  }

  async getDeliveriesBySnapshotId(snapshotId: string): Promise<ReportDelivery[]> {
    const { data, error } = await this.client
      .from(DELIVERY_TABLE)
      .select(DELIVERY_COLUMNS)
      .eq('snapshot_id', snapshotId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeReportDeliveryRow);
  }
}

export const reportDeliveryRepository = new SupabaseReportDeliveryRepository();

export async function createPlannedReportDeliveries(
  planned: CreateReportDeliveryInput[],
  repository: ReportDeliveryRepository = reportDeliveryRepository,
): Promise<ReportDelivery[]> {
  const created: ReportDelivery[] = [];
  for (const input of planned) {
    created.push(await repository.createDelivery(input));
  }
  return created;
}
