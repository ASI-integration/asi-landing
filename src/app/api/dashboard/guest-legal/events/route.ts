import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listGuestLegalEvents } from '@/lib/booking-ops/guest-legal-deposit-mvd-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ ok: true, events: await listGuestLegalEvents(new URL(req.url).searchParams.get('bookingId') ?? '') });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось получить события.' }, { status: 400 });
  }
}
