import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  getEligibleAutoSendIntents,
  getDeliveryStatus,
  toSafeDeliveryView,
} from '@/lib/booking-ops/communication-auto-send-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const url = new URL(req.url);
  const max = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 50);
  const result = await getEligibleAutoSendIntents({
    bookingOpsRecordId: url.searchParams.get('bookingOpsRecordId') || undefined,
    limit: max,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить очередь.' }, { status: 500 });
  }
  const queue = await Promise.all(result.intents.map(async (intent) => {
    const status = await getDeliveryStatus(intent.id);
    return {
      intentId: intent.id,
      bookingOpsRecordId: intent.bookingOpsRecordId,
      messageType: intent.purpose,
      channel: intent.channel,
      actorType: intent.actorType,
      delivery: toSafeDeliveryView(status.delivery),
    };
  }));
  return NextResponse.json({ ok: true, queue });
}
