import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getTariffGrid } from '@/lib/booking-ops/pricing-intelligence-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  try {
    const params = new URL(req.url).searchParams;
    const pricingProfileId = params.get('pricingProfileId')?.trim();
    if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
    const limit = Math.min(180, Math.max(1, Number(params.get('limit') ?? 90)));
    const days = await getTariffGrid(pricingProfileId, limit);
    return NextResponse.json({ ok: true, days, autoApplyIsPlaceholder: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить тарифную сетку.' }, { status: 400 });
  }
}
