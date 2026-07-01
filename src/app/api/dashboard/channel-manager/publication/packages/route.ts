import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listPublicationPackages } from '@/lib/booking-ops/channel-publishing-preparation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const propertySetupId = new URL(req.url).searchParams.get('propertySetupId')?.trim() || undefined;
    const packages = await listPublicationPackages(propertySetupId);
    return NextResponse.json({ ok: true, packages, realOtaPublishingEnabled: false });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить пакеты публикации.' }, { status: 400 });
  }
}
