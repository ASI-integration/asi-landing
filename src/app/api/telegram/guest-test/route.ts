import { NextResponse } from 'next/server';

import { buildGuestTestDeepLink } from '@/lib/communication/telegram-routing';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { propertyId?: string | null } = {};
  try {
    body = (await req.json()) as { propertyId?: string | null };
  } catch {
    body = {};
  }

  const propertyId = body.propertyId?.trim() || null;
  const deepLink = buildGuestTestDeepLink(propertyId);

  return NextResponse.json({
    ok: true,
    deepLink,
    propertyId: propertyId || process.env.TELEGRAM_GUEST_TEST_PROPERTY_ID?.trim() || 'test-prop-tg-live',
  });
}
