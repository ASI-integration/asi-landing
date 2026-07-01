import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getPublicationBlockers, getPublicationReadinessStatus } from '@/lib/booking-ops/channel-publishing-preparation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const url = new URL(req.url);
    const ref = url.searchParams.get('packageId')?.trim() || url.searchParams.get('propertySetupId')?.trim();
    if (!ref) return NextResponse.json({ ok: false, message: 'Укажите ID пакета или профиля объекта.' }, { status: 400 });
    const packageStatus = await getPublicationReadinessStatus(ref);
    const blockers = packageStatus ? await getPublicationBlockers(ref) : [];
    return NextResponse.json({ ok: true, package: packageStatus, blockers, realOtaPublishingEnabled: false });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить статус публикации.' }, { status: 400 });
  }
}
