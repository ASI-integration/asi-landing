import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { supabase } from '@/lib/supabase';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const { accountId } = await resolveReservationAccess(auth.session);
  const bookingId = new URL(req.url).searchParams.get('bookingOpsRecordId');
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId))
    return NextResponse.json({ ok: false, error: 'booking_id_required' }, { status: 400 });
  const scope = await supabase.from('booking_ops_records').select('id,property_id')
    .eq('id', bookingId).eq('account_id', accountId).maybeSingle();
  if (scope.error) return NextResponse.json({ ok: false, error: 'scope_lookup_failed' }, { status: 503 });
  if (!scope.data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  const [report, entries] = await Promise.all([
    supabase.from('owner_payout_reports').select('*').eq('booking_id', bookingId)
      .eq('account_id', accountId).eq('property_id', scope.data.property_id).maybeSingle(),
    supabase.from('financial_ledger_entries').select('entry_type,account_code,debit_cents,credit_cents,currency')
      .eq('booking_id', bookingId).eq('account_id', accountId).eq('property_id', scope.data.property_id),
  ]);
  if (report.error || entries.error)
    return NextResponse.json({ ok: false, error: 'finance_report_unavailable' }, { status: 503 });
  if (!report.data) return NextResponse.json({ ok: false, error: 'finance_report_not_ready' }, { status: 404 });
  const debit = (entries.data ?? []).reduce((sum,row)=>sum+Number(row.debit_cents),0);
  const credit = (entries.data ?? []).reduce((sum,row)=>sum+Number(row.credit_cents),0);
  const r = report.data;
  const expected = Number(r.gross_revenue_cents)-Number(r.management_commission_cents)
    -Number(r.operational_expenses_cents)+Number(r.deposit_retained_cents);
  const reconciled = debit === credit && Number(r.balance_difference_cents) === 0
    && Number(r.owner_payout_cents) === expected;
  return NextResponse.json({ ok: reconciled, report: r, journal: { debitCents: debit, creditCents: credit, entries: entries.data }, reconciled }, { status: reconciled ? 200 : 422 });
}
