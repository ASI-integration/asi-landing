import { supabase } from '@/lib/supabase';

export type LocationReportMode = 'residential' | 'commercial';
export type LocationReportLocale = 'ru' | 'en';
export type LocationReportDeliveryChannel = 'email' | 'telegram' | 'dashboard';
export type LocationReportAccessTier = 'unknown' | 'included' | 'paid_required';
export type LocationReportRequestStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type LocationReportPaymentProvider = 'manual' | 'prodamus' | 'yookassa';
export type LocationReportOrderAccessStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'generated'
  | 'expired';
export type LocationReportProductType = 'location_report_detail';

export type LocationReportRequestEntity = {
  id: string;
  locale: LocationReportLocale;
  mode: LocationReportMode;
  user_id: string | null;
  account_id: string | null;
  email: string | null;
  address: string;
  lat: number | null;
  lon: number | null;
  delivery_channel: LocationReportDeliveryChannel | null;
  delivery_target: string | null;
  access_tier: LocationReportAccessTier;
  access_status: LocationReportOrderAccessStatus;
  payment_provider: LocationReportPaymentProvider;
  payment_id: string | null;
  payment_url: string | null;
  product_type: LocationReportProductType;
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
  accessStatus?: LocationReportOrderAccessStatus;
  paymentProvider?: LocationReportPaymentProvider;
  userId?: string | null;
  accountId?: string | null;
  email?: string | null;
  paymentId?: string | null;
  paymentUrl?: string | null;
  productType?: LocationReportProductType;
}): Promise<{ requestId: string }> {
  const { data, error } = await supabase
    .from('location_report_requests')
    .insert({
      locale: args.locale,
      mode: args.mode,
      user_id: args.userId ?? null,
      account_id: args.accountId ?? null,
      email: args.email ?? null,
      address: args.address,
      lat: args.lat ?? null,
      lon: args.lon ?? null,
      delivery_channel: args.delivery?.channel ?? null,
      delivery_target: args.delivery?.target ?? null,
      access_tier: args.accessTier ?? 'unknown',
      access_status: args.accessStatus ?? 'draft',
      payment_provider: args.paymentProvider ?? 'manual',
      payment_id: args.paymentId ?? null,
      payment_url: args.paymentUrl ?? null,
      product_type: args.productType ?? 'location_report_detail',
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
    .select('id, locale, mode, user_id, account_id, email, address, lat, lon, delivery_channel, delivery_target, access_tier, access_status, payment_provider, payment_id, payment_url, product_type, status, report_id, error, created_at, updated_at')
    .eq('id', requestId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as any;
}

export async function getLocationReportRequestByReportId(
  reportId: string,
): Promise<LocationReportRequestEntity | null> {
  const { data, error } = await supabase
    .from('location_report_requests')
    .select('id, locale, mode, user_id, account_id, email, address, lat, lon, delivery_channel, delivery_target, access_tier, access_status, payment_provider, payment_id, payment_url, product_type, status, report_id, error, created_at, updated_at')
    .eq('report_id', reportId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as any;
}

export function hasPaidLocationReportAccess(entity: Pick<LocationReportRequestEntity, 'access_status'>): boolean {
  return entity.access_status === 'paid' || entity.access_status === 'generated';
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
    .update({ status: 'completed', access_status: 'generated', report_id: args.reportId, error: null })
    .eq('id', args.requestId);
  if (error) throw new Error(error.message);
}

export async function markLocationReportRequestPaid(args: {
  requestId: string;
  paymentId?: string | null;
  paymentProvider?: LocationReportPaymentProvider;
}): Promise<void> {
  const patch: Record<string, string | null> = { access_status: 'paid', error: null };
  if (args.paymentId) patch.payment_id = args.paymentId;
  if (args.paymentProvider) patch.payment_provider = args.paymentProvider;

  const { error } = await supabase
    .from('location_report_requests')
    .update(patch)
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

