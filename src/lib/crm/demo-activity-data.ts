import { demoCrmContacts } from './demo-data';
import type { CrmEventRow } from './queue-events';

const demoBase = '2026-06-19T09:40:00.000Z';

export const demoCrmEventsForFeed: CrmEventRow[] = [
  {
    id: 'demo-event-001',
    contact_id: 'demo-crm-onb-002',
    event_type: 'status_change',
    message_text: null,
    metadata: {},
    created_at: demoBase,
  },
  {
    id: 'demo-event-002',
    contact_id: 'demo-crm-onb-001',
    event_type: 'message_inbound',
    message_text: 'Хочу подключить квартиру к ASI',
    metadata: { role: 'owner' },
    created_at: '2026-06-19T09:36:00.000Z',
  },
  {
    id: 'demo-event-003',
    contact_id: 'demo-crm-onb-003',
    event_type: 'operator_followup_required',
    message_text: 'Позовите оператора',
    metadata: {},
    created_at: '2026-06-19T09:15:00.000Z',
  },
  {
    id: 'demo-event-004',
    contact_id: 'demo-crm-onb-001',
    event_type: 'missing_data',
    message_text: null,
    metadata: { missing_fields: ['wifi'] },
    created_at: '2026-06-19T09:37:00.000Z',
  },
  {
    id: 'demo-event-005',
    contact_id: 'demo-crm-onb-002',
    event_type: 'guest_concierge_answered',
    message_text: 'Ответ гостю по правилам проживания',
    metadata: { safeGuestReply: 'Заезд с 15:00, выезд до 11:00.' },
    created_at: '2026-06-19T09:38:00.000Z',
  },
];

export function isDemoContactId(contactId: string): boolean {
  return demoCrmContacts.some((contact) => contact.id === contactId);
}

export function shouldUseDemoActivityEvents(contactIds: string[]): boolean {
  return contactIds.length > 0 && contactIds.every((id) => isDemoContactId(id));
}
