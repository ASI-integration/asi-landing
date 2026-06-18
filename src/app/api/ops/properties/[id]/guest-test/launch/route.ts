import { NextResponse } from 'next/server';

import { launchGuestTestForProperty } from '@/lib/crm/guest-test-flow';
import {
  opsFoundationApiErrorResponse,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import {
  getMasterCard,
  getProperty,
  getSetupProfile,
  listPropertyMedia,
} from '@/lib/ops-foundation/repository';
import { computeObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { normalizeSetupData, setupDataFromExisting } from '@/lib/property-setup/setup-data';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

async function safeMediaCount(ctx: Parameters<typeof listPropertyMedia>[0], propertyId: string): Promise<number> {
  try {
    const media = await listPropertyMedia(ctx, propertyId);
    return media.filter((item) => item.status === 'active').length;
  } catch {
    return 0;
  }
}

export async function POST(_: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const property = await getProperty(auth.ctx, params.id);
    if (!property) {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }

    let masterCard = null;
    try {
      masterCard = await getMasterCard(auth.ctx, params.id);
    } catch {
      masterCard = null;
    }

    const profileRaw = await getSetupProfile(auth.ctx, params.id);
    const mediaCount = await safeMediaCount(auth.ctx, params.id);
    const setup = profileRaw
      ? normalizeSetupData(profileRaw)
      : setupDataFromExisting(property, masterCard);

    const readiness = computeObjectGuestReadiness({
      propertyId: params.id,
      property,
      masterCard,
      setup,
      mediaCount,
    });

    if (!readiness.isReady) {
      return NextResponse.json({ ok: false, error: 'property_not_ready' }, { status: 409 });
    }

    const result = await launchGuestTestForProperty(params.id);

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      deepLink: result.deepLink,
      guestTestCommand: result.guestTestCommand,
      telegramBotUrl: result.telegramBotUrl,
      guestTestFlow: result.guestTestFlow,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
