import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getCrmContactById } from '@/lib/crm/repository';
import { archiveCrmQueueContact } from '@/lib/crm/queue-archive';
import { isQueueItemArchivable, buildQueueItem } from '@/lib/crm/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ArchiveBody = {
  contactId?: unknown;
};

function objectTitleFromContact(contact: Awaited<ReturnType<typeof getCrmContactById>>): string | null {
  if (!contact) return null;
  if (contact.activeObjectTitle?.trim()) return contact.activeObjectTitle.trim();
  if (contact.city.trim()) return `Объект в ${contact.city.trim()}`;
  if (contact.objectsCount > 0) return `Объект (${contact.objectsCount})`;
  return contact.name.trim() || 'Новый объект';
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  let body: ArchiveBody;
  try {
    body = (await req.json()) as ArchiveBody;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный запрос.' }, { status: 400 });
  }

  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
  if (!contactId) {
    return NextResponse.json({ ok: false, message: 'Укажите карточку для архивации.' }, { status: 400 });
  }

  try {
    const contact = await getCrmContactById(contactId);
    if (!contact) {
      return NextResponse.json({ ok: false, message: 'Карточка не найдена.' }, { status: 404 });
    }
    if (contact.crmArchived) {
      return NextResponse.json({ ok: true, contactId, alreadyArchived: true });
    }

    const queueItem = buildQueueItem(contact);
    if (!isQueueItemArchivable(queueItem)) {
      return NextResponse.json(
        { ok: false, message: 'Эту карточку нельзя скрыть из очереди в текущем статусе.' },
        { status: 400 },
      );
    }

    const operatorEmail = auth.session.email ?? 'operator';
    await archiveCrmQueueContact({
      contactId,
      operatorEmail,
      objectTitle: objectTitleFromContact(contact),
    });

    return NextResponse.json({ ok: true, contactId });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось скрыть карточку из очереди.' }, { status: 500 });
  }
}
