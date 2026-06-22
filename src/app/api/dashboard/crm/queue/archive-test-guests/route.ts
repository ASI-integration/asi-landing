import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { archiveCrmQueueTestGuests } from '@/lib/crm/queue-archive-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ArchiveTestGuestsBody = {
  contactIds?: unknown;
};

function parseContactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  let body: ArchiveTestGuestsBody = {};
  try {
    body = (await req.json()) as ArchiveTestGuestsBody;
  } catch {
    body = {};
  }

  try {
    const operatorEmail = auth.session.email ?? 'operator';
    const result = await archiveCrmQueueTestGuests(operatorEmail, parseContactIds(body.contactIds));
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: 'Не удалось скрыть тестовые карточки. Попробуйте обновить страницу.',
      },
      { status: 500 },
    );
  }
}
