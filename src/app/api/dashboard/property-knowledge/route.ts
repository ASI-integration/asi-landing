import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  listPropertyKnowledge,
  lookupPropertyKnowledge,
  upsertPropertyKnowledge,
  type PropertyKnowledgeInput,
} from '@/lib/booking-ops/property-knowledge';
import {
  extractPropertyKnowledge,
  mergePropertyKnowledgeIntake,
  PROPERTY_KNOWLEDGE_INTAKE_FIELDS,
  SENSITIVE_INTAKE_FIELDS,
  type PropertyKnowledgeIntakeDraft,
  type PropertyKnowledgeIntakeField,
} from '@/lib/booking-ops/property-knowledge-intake';

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

const PROPERTY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const INTAKE_FIELDS = new Set<string>(PROPERTY_KNOWLEDGE_INTAKE_FIELDS);
const SENSITIVE_FIELDS = new Set<string>(SENSITIVE_INTAKE_FIELDS);

function readPropertyId(body: Record<string, unknown>): string | null {
  const propertyId = String(body.propertyId ?? body.property_id ?? '').trim();
  return PROPERTY_ID_PATTERN.test(propertyId) ? propertyId : null;
}

function readFieldList(value: unknown): PropertyKnowledgeIntakeField[] | null {
  if (!Array.isArray(value)) return null;
  const fields = value.map((item) => String(item));
  if (fields.some((field) => !INTAKE_FIELDS.has(field))) return null;
  return [...new Set(fields)] as PropertyKnowledgeIntakeField[];
}

function readIntakeDraft(value: unknown): PropertyKnowledgeIntakeDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const draft: PropertyKnowledgeIntakeDraft = {};
  for (const [field, fieldValue] of Object.entries(source)) {
    if (!INTAKE_FIELDS.has(field) || typeof fieldValue !== 'string' || fieldValue.length > 10_000) return null;
    if (field === 'propertyLabel' && fieldValue.length > 500) return null;
    draft[field as PropertyKnowledgeIntakeField] = fieldValue;
  }
  return draft;
}

async function parseIntake(body: Record<string, unknown>): Promise<NextResponse> {
  const propertyId = readPropertyId(body);
  const propertyLabel = String(body.propertyLabel ?? '').trim();
  const rawText = typeof body.rawText === 'string' ? body.rawText : '';
  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'ID объекта может содержать только латинские буквы, цифры, точку, дефис, подчёркивание и двоеточие.' }, { status: 400 });
  }
  if (propertyLabel.length > 500) {
    return NextResponse.json({ ok: false, message: 'Название объекта слишком длинное.' }, { status: 400 });
  }
  if (!rawText.trim() || rawText.length > 50_000) {
    return NextResponse.json({ ok: false, message: 'Вставьте текст объёмом до 50 000 знаков.' }, { status: 400 });
  }

  const existingLookup = await lookupPropertyKnowledge({ propertyId });
  if (existingLookup.match === 'error') {
    return NextResponse.json({ ok: false, message: existingLookup.error }, { status: 500 });
  }

  const extraction = extractPropertyKnowledge(rawText);
  if (propertyLabel) {
    extraction.draft.propertyLabel = propertyLabel;
    extraction.confidence.propertyLabel = 'high';
    extraction.notFound = extraction.notFound.filter((field) => field !== 'propertyLabel');
  }
  const approvedFields = PROPERTY_KNOWLEDGE_INTAKE_FIELDS.filter((field) => Boolean(extraction.draft[field]));
  const preview = mergePropertyKnowledgeIntake({
    propertyId,
    draft: extraction.draft,
    approvedFields,
  });

  return NextResponse.json({
    ok: true,
    draft: extraction.draft,
    confidence: extraction.confidence,
    warnings: extraction.warnings,
    notFound: extraction.notFound,
    changedFields: preview.changedFields,
    sensitiveConflicts: preview.sensitiveConflicts,
    existing: existingLookup.knowledge,
  });
}

async function saveIntake(body: Record<string, unknown>): Promise<NextResponse> {
  const propertyId = readPropertyId(body);
  const draft = readIntakeDraft(body.draft);
  const approvedFields = readFieldList(body.approvedFields);
  const confirmedSensitiveFields = readFieldList(body.confirmedSensitiveFields);
  if (!propertyId || !draft || !approvedFields || !confirmedSensitiveFields) {
    return NextResponse.json({ ok: false, message: 'Некорректные данные подтверждения.' }, { status: 400 });
  }
  if (confirmedSensitiveFields.some((field) => !SENSITIVE_FIELDS.has(field) || !approvedFields.includes(field))) {
    return NextResponse.json({ ok: false, message: 'Некорректное подтверждение защищённых полей.' }, { status: 400 });
  }

  const existingLookup = await lookupPropertyKnowledge({ propertyId });
  if (existingLookup.match === 'error') {
    return NextResponse.json({ ok: false, message: existingLookup.error }, { status: 500 });
  }
  const merge = mergePropertyKnowledgeIntake({
    propertyId,
    draft,
    approvedFields,
    confirmedSensitiveFields,
    existing: existingLookup.knowledge,
  });
  if (merge.sensitiveConflicts.length > 0) {
    return NextResponse.json({
      ok: false,
      message: 'Подтвердите замену существующих кодов или пароля.',
      sensitiveConflicts: merge.sensitiveConflicts,
    }, { status: 409 });
  }
  if (merge.changedFields.length === 0) {
    return NextResponse.json({ ok: false, message: 'Нет подтверждённых изменений для сохранения.' }, { status: 400 });
  }

  const result = await upsertPropertyKnowledge(merge.input);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, record: result.record, changedFields: merge.changedFields });
}

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

  if (body.action === 'parse_intake') return parseIntake(body);
  if (body.action === 'save_intake') return saveIntake(body);

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
