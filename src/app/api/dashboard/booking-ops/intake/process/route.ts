import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  requireBookingOpsApiAccess,
  requireBookingOpsApiAccount,
  requireBookingOpsApiPropertyAccess,
} from '../../access';
import { processInboundBookingRequest } from '@/lib/booking-ops/real-booking-intake-autopilot';
import { recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const account = await requireBookingOpsApiAccount(auth.session);
  if (!account.ok) return account.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const source = String(body.source ?? 'admin').trim() as 'admin' | 'web' | 'telegram';
  const allowedSources = new Set(['admin', 'web', 'telegram', 'email_placeholder', 'channel_manager_placeholder']);
  if (!allowedSources.has(source)) {
    return NextResponse.json({ ok: false, message: 'Недопустимый источник.' }, { status: 400 });
  }

  const propertyId = typeof body.propertyId === 'string'
    ? body.propertyId.trim()
    : typeof body.propertyReference === 'string'
      ? body.propertyReference.trim()
      : '';
  const attachPropertyId = typeof body.attachPropertyId === 'string'
    ? body.attachPropertyId.trim()
    : '';
  const propertyTargets = [...new Set([propertyId, attachPropertyId].filter(Boolean))];
  for (const targetPropertyId of propertyTargets) {
    const propertyAccess = await requireBookingOpsApiPropertyAccess(auth.session, targetPropertyId);
    if (!propertyAccess.ok) return propertyAccess.response;
  }

  const duplicateOfBookingId = typeof body.duplicateOfBookingId === 'string'
    ? body.duplicateOfBookingId.trim()
    : '';
  if (duplicateOfBookingId) {
    const duplicateAccess = await requireBookingOpsApiAccess(auth.session, duplicateOfBookingId);
    if (!duplicateAccess.ok) return duplicateAccess.response;
  }

  const result = await processInboundBookingRequest(body, source, {
    inputTrust: 'authenticated_internal',
    accountId: account.accountId,
    force: body.force === true,
    action: typeof body.action === 'string'
      ? body.action as 'process' | 'mark_duplicate' | 'attach_property' | 'attach_guest' | 'request_missing_data' | 'create_fallback'
      : 'process',
    attachPropertyId: typeof body.attachPropertyId === 'string' ? body.attachPropertyId : undefined,
    attachPropertyLabel: typeof body.attachPropertyLabel === 'string' ? body.attachPropertyLabel : undefined,
    attachGuestName: typeof body.attachGuestName === 'string' ? body.attachGuestName : undefined,
    attachGuestPhone: typeof body.attachGuestPhone === 'string' ? body.attachGuestPhone : undefined,
    attachGuestEmail: typeof body.attachGuestEmail === 'string' ? body.attachGuestEmail : undefined,
    attachGuestTelegram: typeof body.attachGuestTelegram === 'string' ? body.attachGuestTelegram : undefined,
    duplicateOfBookingId: typeof body.duplicateOfBookingId === 'string' ? body.duplicateOfBookingId : undefined,
    intakeEventId: typeof body.intakeEventId === 'string' ? body.intakeEventId : undefined,
  });

  if (result.bookingId && result.intakeStatus !== 'duplicate' && !result.missingRequiredFields.includes('property')) {
    const bookingAccess = await requireBookingOpsApiAccess(auth.session, result.bookingId);
    if (!bookingAccess.ok) return bookingAccess.response;
    const expectedScope = {
      accountId: bookingAccess.accountId,
      propertyId: bookingAccess.propertyId,
    };
    await recordAndProcessBookingEvent({
      id: result.intakeId,
      bookingId: bookingAccess.bookingId,
      objectId: bookingAccess.propertyId,
      type: 'booking.received',
      actorType: 'operator',
      actorId: auth.session.email ?? auth.session.userId ?? null,
      source: `booking_intake:${source}`,
      correlationId: result.intakeId,
      payload: { intakeStatus: result.intakeStatus },
    }, expectedScope);
  }

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
