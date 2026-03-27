import { CommunicationChannel, InboundMessageEnvelope, PhoneCallRecord } from './types';

export type TimelineEvent = 
  | { type: 'message_inbound'; channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'message_outbound'; channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'call_record'; record: PhoneCallRecord; ts: Date }
  | { type: 'payment_event'; status: string; ts: Date }
  | { type: 'escalation'; reason: string; ts: Date }
  | { type: 'property_knowledge_upserted'; property_id: string; created: boolean; ts: Date }
  | { type: 'reservation_upserted'; reservation_ref: string; created: boolean; ts: Date };

export interface GlobalTimeline {
  guestId: string;
  events: TimelineEvent[];
}

const timelineDB = new Map<string, GlobalTimeline>();

export async function appendTimelineEvent(guestId: string, event: TimelineEvent) {
  if (!timelineDB.has(guestId)) {
    timelineDB.set(guestId, { guestId, events: [] });
  }
  const timeline = timelineDB.get(guestId)!;
  timeline.events.push(event);
  timeline.events.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

export async function getTimeline(guestId: string): Promise<GlobalTimeline> {
  return timelineDB.get(guestId) || { guestId, events: [] };
}
