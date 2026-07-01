import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listImportedChannelBookings } from '@/lib/booking-ops/channel-manager-access-import';
export const dynamic = 'force-dynamic';
export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession(); if ('error' in auth) return auth.error;
  try { const rows = await listImportedChannelBookings(new URL(req.url).searchParams.get('connectionId') ?? undefined); return NextResponse.json({ ok: true, bookings: rows.map(({ raw_snapshot: _raw, guest_contact_ref: _contact, ...row }) => row) }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить брони.' }, { status: 400 }); }
}
