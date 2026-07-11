import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  let query = supabase.from('booking_ops_alerts').select('*');
  const exact: Array<[string, string]> = [['status','status'], ['severity','severity'], ['propertyId','property_id'], ['bookingId','booking_id'], ['sourceGate','source_gate'], ['nextBookingId','booking_id']];
  for (const [param, column] of exact) { const value = params.get(param); if (value) query = query.eq(column, value); }
  if (params.get('activeOnly') !== 'false') query = query.in('status', ['open', 'acknowledged']);
  if (params.get('deadlineFrom')) query = query.gte('deadline_at', params.get('deadlineFrom')!);
  if (params.get('deadlineTo')) query = query.lte('deadline_at', params.get('deadlineTo')!);
  const result = await query.order('next_check_in_at').order('deadline_at').order('detected_at', { ascending: false }).limit(200);
  if (result.error) return NextResponse.json({ ok: false, message: result.error.message }, { status: 400 });
  const statusRank: Record<string, number> = { open: 0, acknowledged: 1, resolved: 2 };
  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const alerts = [...(result.data ?? [])].sort((a, b) =>
    (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
    || (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
    || String(a.next_check_in_at ?? '9999').localeCompare(String(b.next_check_in_at ?? '9999'))
    || String(a.deadline_at ?? '9999').localeCompare(String(b.deadline_at ?? '9999')));
  return NextResponse.json({ ok: true, alerts });
}
