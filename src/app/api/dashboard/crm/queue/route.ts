import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { listCrmContacts } from '@/lib/crm/repository';
import { listCrmEventsByContactIds } from '@/lib/crm/queue-events';
import {
  buildOperatorInbox,
  buildQueueItems,
  computeQueueMetrics,
  CRM_QUEUE_FILTER_VALUES,
  CrmQueueFilter,
  emptyQueueColumns,
  filterQueueItems,
  groupQueueByColumn,
} from '@/lib/crm/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDashboardSession(): Promise<NextResponse | null> {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ ok: false, message: 'Доступ к CRM не настроен.' }, { status: 401 });
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть очередь CRM.' }, { status: 401 });
  }
  return null;
}

function parseFilter(value: string | null): CrmQueueFilter {
  if (value && CRM_QUEUE_FILTER_VALUES.includes(value as CrmQueueFilter)) {
    return value as CrmQueueFilter;
  }
  return 'all';
}

export async function GET(req: Request): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get('filter'));

  try {
    const contacts = await listCrmContacts();
    const contactIds = contacts.map((contact) => contact.id);
    const messagesByContact = await listCrmEventsByContactIds(contactIds);
    const items = buildQueueItems(contacts, messagesByContact);
    const filtered = filterQueueItems(items, filter);

    return NextResponse.json({
      ok: true,
      filter,
      metrics: computeQueueMetrics(items),
      operatorInbox: buildOperatorInbox(items),
      columns: groupQueueByColumn(filtered),
      items: filtered,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить очередь CRM.' }, { status: 500 });
  }
}
