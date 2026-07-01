import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  createBookingFromImportedChannelBooking, getChannelImportConflicts, reconcileImportedBookings,
  reconcileImportedObjects, updateChannelImportEntity,
} from '@/lib/booking-ops/channel-manager-access-import';
export const runtime = 'nodejs';
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession(); if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>; const action = String(body.action ?? ''); const connectionId = String(body.connectionId ?? '');
    if (action === 'reconcile_objects') return NextResponse.json({ ok: true, result: await reconcileImportedObjects(connectionId), conflicts: await getChannelImportConflicts(connectionId) });
    if (action === 'reconcile_bookings') return NextResponse.json({ ok: true, result: await reconcileImportedBookings(connectionId), conflicts: await getChannelImportConflicts(connectionId) });
    if (action === 'create_booking_from_imported') return NextResponse.json({ ok: true, result: await createBookingFromImportedChannelBooking(String(body.importedBookingId ?? '')) });
    if (action === 'ignore_imported_object') { await updateChannelImportEntity('booking_channel_imported_objects', String(body.importedObjectId ?? ''), { match_status: 'ignored' }); return NextResponse.json({ ok: true }); }
    if (action === 'ignore_imported_booking') { await updateChannelImportEntity('booking_channel_imported_bookings', String(body.importedBookingId ?? ''), { match_status: 'ignored' }); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить сверку.' }, { status: 400 }); }
}
