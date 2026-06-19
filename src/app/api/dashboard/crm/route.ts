import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import { createCrmContact, listCrmContacts } from '@/lib/crm/repository';
import { normalizeCrmContactInput, validateCrmContact } from '@/lib/crm/normalize';
import { CRM_SOURCE_VALUES, CRM_STATUS_VALUES, CrmSource, CrmStatus } from '@/lib/crm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDashboardSession(): Promise<NextResponse | null> {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ ok: false, message: 'Доступ к CRM не настроен.' }, { status: 401 });
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть CRM.' }, { status: 401 });
  }
  return null;
}

function parseStatus(value: string | null): CrmStatus | 'all' | undefined {
  if (!value || value === 'all') return value === 'all' ? 'all' : undefined;
  return CRM_STATUS_VALUES.includes(value as CrmStatus) ? (value as CrmStatus) : undefined;
}

function parseSource(value: string | null): CrmSource | 'all' | undefined {
  if (!value || value === 'all') return value === 'all' ? 'all' : undefined;
  return CRM_SOURCE_VALUES.includes(value as CrmSource) ? (value as CrmSource) : undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const url = new URL(req.url);
  try {
    const contacts = await listCrmContacts({
      status: parseStatus(url.searchParams.get('status')),
      source: parseSource(url.searchParams.get('source')),
      search: url.searchParams.get('search') ?? undefined,
    });
    return NextResponse.json({ ok: true, contacts });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить CRM.' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте данные лида.' }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: 'Не удалось добавить лида.' }, { status: 500 });
  }
}
