import { supabase } from '@/lib/supabase';

export type LocationReportMode = 'residential' | 'commercial';
export type LocationReportLocale = 'ru' | 'en';
export type LocationReportDeliveryChannel = 'email' | 'telegram' | 'dashboard';
export type LocationReportAccessTier = 'unknown' | 'included' | 'paid_required';
export type LocationReportRequestStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type LocationReportPaymentStatus =
  | 'created'
  | 'pending_payment'
  | 'paid_unlocked'
  | 'failed'
  | 'cancelled';

export type LocationReportRequestEntity = {
  id: string;
  locale: LocationReportLocale;
  mode: LocationReportMode;
  address: string;
  lat: number | null;
  lon: number | null;
  delivery_channel: LocationReportDeliveryChannel | null;
  delivery_target: string | null;
  access_tier: LocationReportAccessTier;
  payment_status: LocationReportPaymentStatus;
  status: LocationReportRequestStatus;
  report_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function createLocationReportRequest(args: {
  locale: LocationReportLocale;
  mode: LocationReportMode;
  address: string;
  lat?: number | null;
  lon?: number | null;
  delivery?: { channel: LocationReportDeliveryChannel; target: string } | null;
  accessTier?: LocationReportAccessTier;
  paymentStatus?: LocationReportPaymentStatus;
}): Promise<{ requestId: string }> {
  const accessTier = args.accessTier ?? 'unknown';
  const paymentStatus =
    args.paymentStatus ?? (accessTier === 'paid_required'
      ? 'pending_payment'
      : accessTier === 'included'
        ? 'paid_unlocked'
        : 'created');
  const { data, error } = await supabase
    .from('location_report_requests')
    .insert({
      locale: args.locale,
      mode: args.mode,
      address: args.address,
      lat: args.lat ?? null,
      lon: args.lon ?? null,
      delivery_channel: args.delivery?.channel ?? null,
      delivery_target: args.delivery?.target ?? null,
      access_tier: accessTier,
      payment_status: paymentStatus,
      status: 'queued',
    })
    .select('id')
    .single();

  if (error || !data?.id) throw new Error(error?.message || 'failed_to_create_request');
  return { requestId: data.id as string };
}

export async function getLocationReportRequestById(
  requestId: string,
): Promise<LocationReportRequestEntity | null> {
  const { data, error } = await supabase
    .from('location_report_requests')
    .select('id, locale, mode, address, lat, lon, delivery_channel, delivery_target, access_tier, payment_status, status, report_id, error, created_at, updated_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as any;
}

export async function markLocationReportRequestPaymentUnlocked(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('location_report_requests')
    .update({ payment_status: 'paid_unlocked', error: null })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

export async function markLocationReportRequestPaymentFailed(args: {
  requestId: string;
  paymentStatus: Extract<LocationReportPaymentStatus, 'failed' | 'cancelled'>;
  errorMessage?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('location_report_requests')
    .update({ payment_status: args.paymentStatus, error: args.errorMessage ?? null })
    .eq('id', args.requestId);
  if (error) throw new Error(error.message);
}

export async function markLocationReportRequestProcessing(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('location_report_requests')
    .update({ status: 'processing', error: null })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

export async function markLocationReportRequestCompleted(args: { requestId: string; reportId: string }): Promise<void> {
  const { error } = await supabase
    .from('location_report_requests')
    .update({ status: 'completed', report_id: args.reportId, error: null })
    .eq('id', args.requestId);
  if (error) throw new Error(error.message);
}

export async function markLocationReportRequestFailed(args: { requestId: string; errorMessage: string }): Promise<void> {
  const { error } = await supabase
    .from('location_report_requests')
    .update({ status: 'failed', error: args.errorMessage })
    .eq('id', args.requestId);
  if (error) throw new Error(error.message);
}

