import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { OpsFoundationUnavailableError } from '@/lib/ops-foundation/repository';
import {
  getMasterCard,
  getProperty,
  getSetupProfile,
  listPropertyMedia,
  updateMasterCard,
  updateProperty,
  upsertSetupProfile,
} from '@/lib/ops-foundation/repository';
import { syncCrmAfterPropertySetupSave } from '@/lib/crm/property-readiness-sync';
import {
  computeObjectGuestReadiness,
} from '@/lib/property-setup/object-guest-readiness';
import {
  buildSetupMirrorUpdates,
  normalizeSetupData,
  setupDataFromExisting,
  type PropertySetupData,
} from '@/lib/property-setup/setup-data';

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

export async function GET(_: Request, { params }: RouteParams) {
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

    const setup: PropertySetupData = profileRaw
      ? normalizeSetupData(profileRaw)
      : setupDataFromExisting(property, masterCard);

    const readiness = computeObjectGuestReadiness({
      propertyId: params.id,
      property,
      masterCard,
      setup,
      mediaCount,
    });

    return NextResponse.json({ ok: true, property, masterCard, mediaCount, setup, readiness });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const property = await getProperty(auth.ctx, params.id);
    if (!property) {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }

    const body = await readJsonObject(req);
    const setup = normalizeSetupData(body.setup ?? body);
    const mirror = buildSetupMirrorUpdates(setup);

    // Зеркалируем ключевые поля в существующие таблицы (всегда доступно).
    await updateProperty(auth.ctx, params.id, mirror.property);
    await updateMasterCard(auth.ctx, params.id, mirror.masterCard);

    // Полный черновик — в отдельную таблицу. Если миграция ещё не применена,
    // не падаем: ключевые поля уже сохранены, а расширенные данные подключатся позже.
    let extrasPersisted = true;
    try {
      await upsertSetupProfile(auth.ctx, params.id, setup as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof OpsFoundationUnavailableError) {
        extrasPersisted = false;
      } else {
        throw err;
      }
    }

    const mediaCount = await safeMediaCount(auth.ctx, params.id);
    let masterCard = null;
    try {
      masterCard = await getMasterCard(auth.ctx, params.id);
    } catch {
      masterCard = null;
    }
    const readiness = computeObjectGuestReadiness({
      propertyId: params.id,
      property,
      masterCard,
      setup,
      mediaCount,
    });

    void syncCrmAfterPropertySetupSave(params.id);

    return NextResponse.json({ ok: true, setup, extrasPersisted, readiness, mediaCount });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
