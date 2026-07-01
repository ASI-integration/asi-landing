import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listChannelCalendarSnapshots } from '@/lib/booking-ops/channel-manager-access-import';
export const dynamic = 'force-dynamic';
export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error;
  try { const rows = await listChannelCalendarSnapshots(new URL(req.url).searchParams.get('connectionId') ?? undefined); return NextResponse.json({ ok: true, calendar: rows.map(({ raw_snapshot: _raw, ...row }) => row) }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить календарь.' }, { status: 400 }); }
}
