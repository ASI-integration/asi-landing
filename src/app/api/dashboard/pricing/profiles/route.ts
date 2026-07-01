import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listPricingProfiles } from '@/lib/booking-ops/pricing-intelligence-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const propertySetupId = new URL(req.url).searchParams.get('propertySetupId')?.trim() || undefined;
    const profiles = await listPricingProfiles(propertySetupId);
    return NextResponse.json({ ok: true, profiles, autoApplyIsPlaceholder: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить профили ценообразования.' }, { status: 400 });
  }
}
