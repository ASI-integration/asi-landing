import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  listPropertyKnowledge,
  lookupPropertyKnowledge,
  upsertPropertyKnowledge,
  type PropertyKnowledgeInput,
} from '@/lib/booking-ops/property-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE_FIELDS = [
  'propertyLabel',
  'address',
  'entranceInstructions',
  'floorApartment',
  'intercomCode',
  'keyPickupInstructions',
  'wifiName',
  'wifiPassword',
  'parkingInstructions',
  'houseRules',
  'quietHours',
  'checkoutInstructions',
  'emergencyInstructions',
  'cleaningLinenNotes',
  'publicGuestNotes',
  'privateOperatorNotes',
] as const;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const propertyId = new URL(req.url).searchParams.get('property_id')?.trim();
  if (propertyId) {
    const lookup = await lookupPropertyKnowledge({ propertyId });
    if (lookup.match === 'error') {
      return NextResponse.json({ ok: false, message: lookup.error }, { status: 500 });
    }
    if (!lookup.knowledge) {
      return NextResponse.json({ ok: false, message: 'Карточка объекта не найдена.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, record: lookup.knowledge });
  }

  const result = await listPropertyKnowledge();
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, records: result.records });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const propertyId = String(body.propertyId ?? body.property_id ?? '').trim();
  if (!propertyId || propertyId.length > 200) {
    return NextResponse.json({ ok: false, message: 'Укажите корректный ID объекта.' }, { status: 400 });
  }

  const input: PropertyKnowledgeInput = { propertyId };
  let editableFieldCount = 0;
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value !== null && typeof value !== 'string') {
      return NextResponse.json({ ok: false, message: `Поле ${field} должно быть текстом.` }, { status: 400 });
    }
    if (typeof value === 'string' && value.length > 10_000) {
      return NextResponse.json({ ok: false, message: `Поле ${field} слишком длинное.` }, { status: 400 });
    }
    input[field] = value;
    editableFieldCount += 1;
  }
  if (editableFieldCount === 0) {
    return NextResponse.json({ ok: false, message: 'Добавьте данные объекта для сохранения.' }, { status: 400 });
  }

  const result = await upsertPropertyKnowledge(input);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, record: result.record });
}
