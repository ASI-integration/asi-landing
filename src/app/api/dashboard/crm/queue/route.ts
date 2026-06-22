import { NextResponse } from 'next/server';
import { buildActivityFeed, buildCardActivities } from '@/lib/crm/activity-feed';
import { demoCrmEventsForFeed, shouldUseDemoActivityEvents } from '@/lib/crm/demo-activity-data';
import { listCrmContacts } from '@/lib/crm/repository';
import { listCrmEventsByContactIds, listRecentCrmEventsForFeed } from '@/lib/crm/queue-events';
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
import type { CrmEventRow } from '@/lib/crm/queue-events';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseFilter(value: string | null): CrmQueueFilter {
  if (value && CRM_QUEUE_FILTER_VALUES.includes(value as CrmQueueFilter)) {
    return value as CrmQueueFilter;
  }
  return 'all';
}

function groupEventsByContact(events: CrmEventRow[]): Record<string, CrmEventRow[]> {
  const grouped: Record<string, CrmEventRow[]> = {};
  for (const row of events) {
    if (!grouped[row.contact_id]) grouped[row.contact_id] = [];
    grouped[row.contact_id].push(row);
  }
  for (const contactId of Object.keys(grouped)) {
    grouped[contactId].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  return grouped;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get('filter'));

  try {
    const contacts = await listCrmContacts();
    const contactIds = contacts.map((contact) => contact.id);
    const messagesByContact = await listCrmEventsByContactIds(contactIds);

    let feedEvents = await listRecentCrmEventsForFeed();
    if (feedEvents.length === 0 && shouldUseDemoActivityEvents(contactIds)) {
      feedEvents = demoCrmEventsForFeed;
    }

    const eventsByContact = groupEventsByContact(feedEvents);
    const activitiesByContact = Object.fromEntries(
      contacts.map((contact) => [
        contact.id,
        buildCardActivities(contact, eventsByContact[contact.id] ?? []),
      ])
    );

    const items = buildQueueItems(contacts, messagesByContact, activitiesByContact);
    const filtered = filterQueueItems(items, filter);
    const activityFeed = buildActivityFeed(contacts, feedEvents);

    return NextResponse.json({
      ok: true,
      filter,
      metrics: computeQueueMetrics(items),
      operatorInbox: buildOperatorInbox(items),
      columns: groupQueueByColumn(filtered),
      items: filtered,
      activityFeed,
      refreshedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить очередь CRM.' }, { status: 500 });
  }
}
