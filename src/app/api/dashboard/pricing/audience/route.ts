import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { explainAudienceProfile, getAudienceProfile } from '@/lib/booking-ops/property-audience-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const propertySetupId = new URL(req.url).searchParams.get('propertySetupId')?.trim();
    if (!propertySetupId) throw new Error('Укажите propertySetupId.');
    const profile = await getAudienceProfile(propertySetupId);
    const { explanation } = await explainAudienceProfile(propertySetupId);
    return NextResponse.json({ ok: true, profile, explanation });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить профиль аудитории.' }, { status: 400 });
  }
}
