import { NextResponse } from 'next/server';
import { readRequestJson } from '@/lib/safeRequestJson';
import { createCrmContact, listCrmContacts } from '@/lib/crm/repository';
import { normalizeCrmContactInput, validateCrmContact } from '@/lib/crm/normalize';
import { CRM_SOURCE_VALUES, CRM_STATUS_VALUES, CrmSource, CrmStatus } from '@/lib/crm/types';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStatus(value: string | null): CrmStatus | 'all' | undefined {
  if (!value || value === 'all') return value === 'all' ? 'all' : undefined;
  return CRM_STATUS_VALUES.includes(value as CrmStatus) ? (value as CrmStatus) : undefined;
}

function parseSource(value: string | null): CrmSource | 'all' | undefined {
  if (!value || value === 'all') return value === 'all' ? 'all' : undefined;
  return CRM_SOURCE_VALUES.includes(value as CrmSource) ? (value as CrmSource) : undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  try {
    const contacts = await listCrmContacts({
      status: parseStatus(url.searchParams.get('status')),
      source: parseSource(url.searchParams.get('source')),
      search: url.searchParams.get('search') ?? undefined,
      excludeArchived: true,
      includeTest: url.searchParams.get('includeTest') === '1',
    });
    return NextResponse.json({ ok: true, contacts });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить заявки.' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте данные заявки.' }, { status: 400 });
  }

  const input = normalizeCrmContactInput(body.data);
  const validationError = validateCrmContact(input);
  if (validationError) {
    return NextResponse.json({ ok: false, message: validationError }, { status: 400 });
  }

  try {
    const contact = await createCrmContact(input);
    return NextResponse.json({ ok: true, contact }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось добавить заявку.' }, { status: 500 });
  }
}
