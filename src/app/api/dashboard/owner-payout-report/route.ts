import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { requirePropertyPermission } from '@/lib/booking-ops/property-role-access';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Owner-only read API; server role is never trusted to enforce RLS for us. */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const bookingId = url.searchParams.get('bookingOpsRecordId') ?? '';
  const accountId = url.searchParams.get('accountId') ?? '';
  const propertyId = url.searchParams.get('propertyId') ?? '';
  if (![bookingId, accountId, propertyId].every((id) => UUID.test(id))) {
    return NextResponse.json({ ok: false, error: 'invalid_scope' }, { status: 400 });
  }
  try {
    await requirePropertyPermission({ userId: session.userId, accountId, propertyId }, 'view_owner_finance');
  } catch {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  // Supabase service_role can bypass RLS. Every query MUST enforce the
  // independently checked account, property and booking scope.
  const { data: booking, error: bookingError } = await supabase.from('booking_ops_records')
    .select('id').eq('id', bookingId).eq('account_id', accountId).eq('property_id', propertyId)
    .maybeSingle();
  if (bookingError) return NextResponse.json({ ok: false, error: 'lookup_unavailable' }, { status: 503 });
  if (!booking) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const [report, entries] = await Promise.all([
    supabase.from('owner_payout_reports')
      .select('id,booking_id,currency,gross_revenue_cents,deposit_hold_cents,deposit_retained_cents,management_commission_cents,operational_expenses_cents,owner_payout_cents,balance_difference_cents')
      .eq('booking_id', bookingId).eq('account_id', accountId).eq('property_id', propertyId).maybeSingle(),
    supabase.from('financial_ledger_entries')
      .select('entry_type,account_code,debit_cents,credit_cents,currency')
      .eq('booking_id', bookingId).eq('account_id', accountId).eq('property_id', propertyId),
  ]);
  if (report.error || entries.error) {
    return NextResponse.json({ ok: false, error: 'finance_unavailable' }, { status: 503 });
  }
  if (!report.data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  // This is a calculation, not evidence that the actual bank transfer cleared.
  return NextResponse.json({
    ok: true,
    settlementStatus: 'CALCULATED_NOT_BANK_VERIFIED',
    report: report.data,
    journal: entries.data ?? [],
  });
}
