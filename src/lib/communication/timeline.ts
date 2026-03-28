import { CommunicationChannel, InboundMessageEnvelope, PhoneCallRecord } from './types';

export type TimelineEvent =
  | { type: 'message_inbound'; channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'message_outbound'; channel: CommunicationChannel; content: string; ts: Date }
  | { type: 'call_record'; record: PhoneCallRecord; ts: Date }
  | { type: 'payment_event'; status: string; ts: Date }
  | { type: 'escalation'; reason: string; ts: Date }
  | { type: 'property_knowledge_upserted'; property_id: string; created: boolean; ts: Date }
  | { type: 'property_templates_upserted'; property_id: string; created: boolean; ts: Date }
  | { type: 'reservation_upserted'; reservation_ref: string; created: boolean; ts: Date }
  | { type: 'ops_task_created'; task_type: string; task_id: string | null; ts: Date }
  | { type: 'ops_task_updated'; task_id: string; task_status: string; ts: Date }
  | { type: 'ops_task_resolved'; task_id: string; task_type: string; ts: Date }
  | { type: 'unit_state_changed'; property_id: string; from_state: string; to_state: string; ts: Date }
  | { type: 'unit_ready'; property_id: string; reservation_id: string | null; ts: Date }
  | { type: 'unit_blocked'; property_id: string; blocked_reason: string; ts: Date }
  | { type: 'turnover_completed'; property_id: string; reservation_id: string | null; ts: Date }
  | { type: 'stay_flow_readiness_blocked'; property_id: string; blocked_reason: string; reservation_id: string | null; ts: Date }
  | { type: 'stay_flow_readiness_unblocked'; property_id: string; reservation_id: string | null; ts: Date }
  | { type: 'unit_ready_unlocked'; property_id: string; reservation_id: string | null; ts: Date }
  | { type: 'checkin_gate_passed'; property_id: string; reservation_id: string | null; ts: Date };

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
