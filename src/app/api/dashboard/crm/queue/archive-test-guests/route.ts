import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { archiveCrmQueueTestGuests } from '@/lib/crm/queue-archive-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  try {
    const operatorEmail = auth.session.email ?? 'operator';
    const { archivedIds } = await archiveCrmQueueTestGuests(operatorEmail);
    return NextResponse.json({
      ok: true,
      archivedIds,
      archivedCount: archivedIds.length,
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
