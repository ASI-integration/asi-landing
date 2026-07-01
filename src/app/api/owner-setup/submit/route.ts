import { NextResponse } from 'next/server';
import {
  submitOwnerSetupPublicData,
  validateOwnerSetupPublicPayload,
  type OwnerSetupPublicSubmitPayload,
} from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const token = String(body.token ?? '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, message: 'Укажите токен ссылки.' }, { status: 400 });
  }

  const payload: OwnerSetupPublicSubmitPayload = {
    title: typeof body.title === 'string' ? body.title : undefined,
    addressCity: typeof body.addressCity === 'string' ? body.addressCity : undefined,
    addressArea: typeof body.addressArea === 'string' ? body.addressArea : undefined,
    propertyType: typeof body.propertyType === 'string' ? body.propertyType : undefined,
    guestCapacity: typeof body.guestCapacity === 'number' ? body.guestCapacity : Number(body.guestCapacity) || undefined,
    checkinTime: typeof body.checkinTime === 'string' ? body.checkinTime : undefined,
    checkoutTime: typeof body.checkoutTime === 'string' ? body.checkoutTime : undefined,
    rulesText: typeof body.rulesText === 'string' ? body.rulesText : undefined,
    basePriceLabel: typeof body.basePriceLabel === 'string' ? body.basePriceLabel : undefined,
    wifiProvided: body.wifiProvided === true,
    photosPlaceholder: body.photosPlaceholder === true,
  };

  const validationError = validateOwnerSetupPublicPayload(payload);
  if (validationError) {
    return NextResponse.json({ ok: false, message: validationError }, { status: 400 });
  }

  try {
    const result = await submitOwnerSetupPublicData(token, payload);
    return NextResponse.json({
      ok: true,
      message: 'Данные сохранены. Спасибо!',
      readinessScore: result.propertySetup.readinessScore,
      missingFields: result.propertySetup.missingFields,
      status: result.propertySetup.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить данные.';
    const status = message.includes('Слишком много') ? 429 : message.includes('недействительна') ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
