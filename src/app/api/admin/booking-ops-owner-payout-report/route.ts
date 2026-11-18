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
  // PostgreSQL bigint amounts must never be reconciled with floating-point math.
  const toCents = (value: unknown): bigint => {
    const s = String(value);
    if (!/^-?[0-9]+$/.test(s)) throw new Error('invalid_ledger_amount');
    return BigInt(s);
  };
  let debit: bigint, credit: bigint, expected: bigint, payout: bigint;
  try {
    debit = (entries.data ?? []).reduce((sum, row) => sum + toCents(row.debit_cents), 0n);
    credit = (entries.data ?? []).reduce((sum, row) => sum + toCents(row.credit_cents), 0n);
    const r = report.data;
    expected = toCents(r.gross_revenue_cents) - toCents(r.management_commission_cents)
      - toCents(r.operational_expenses_cents) + toCents(r.deposit_retained_cents);
    payout = toCents(r.owner_payout_cents);
    if (toCents(r.balance_difference_cents) !== 0n) throw new Error('balance_difference');
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_financial_values' }, { status: 422 });
  }
  const reconciled = debit === credit && payout === expected && (entries.data?.length ?? 0) >= 10;
  return NextResponse.json({ ok: reconciled, report: report.data,
    journal: { debitCents: debit.toString(), creditCents: credit.toString(), entries: entries.data },
    reconciled }, { status: reconciled ? 200 : 422 });
}
