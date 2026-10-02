import { BOOKING_OPS_STATUSES, BOOKING_OPS_STATUS_LABELS_RU, type BookingOpsStatus } from '@/lib/booking-ops/types';
import { supabase } from '@/lib/supabase';
import { objectKnowledgeFact, prepareCommunicationFactReply } from './knowledge-boundary';
import { resolveCommunicationFacts, readCommunicationDependency, sameCommunicationScope,
  type CommunicationFact, type CommunicationFactScope } from './knowledge-provenance';

type Db = typeof supabase;
type Row = Record<string, unknown>;
export type BookingFactRequest = {
  recordId: string; accountId?: string | null; propertyId?: string | null;
  bookingId?: string | null; purpose: string;
};
const propertyKeys = new Set(['address', 'house_rules', 'parking', 'checkout_time', 'wifi', 'access']);
export function bookingCommunicationFactKeys(purpose: string): string[] {
  if (/checkin.*instruction|check_in|access|unit_ready/.test(purpose)) return ['booking_status', 'readiness', 'address', 'access'];
  if (/checkout|check_out/.test(purpose)) return ['booking_status', 'checkout_at', 'checkout_time'];
  if (/deposit|payment|refund/.test(purpose)) return ['booking_status', 'deposit'];
  if (/document|contract|mvd/.test(purpose)) return ['booking_status', 'contract'];
  if (/clean|readiness|preparation|inspection|linen/.test(purpose)) return ['booking_status', 'readiness'];
  if (/arrival|before_checkin/.test(purpose)) return ['booking_status', 'checkin_at', 'address'];
  // Unknown/new purposes cannot silently bypass the contract.
  return ['booking_status'];
}
function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('knowledge_identity_missing');
  return value;
}
async function one(db: Db, table: string, id: string): Promise<Row> {
  const response = await db.from(table).select('*').eq('id', id).maybeSingle();
  if (response.error || !response.data || response.data.id !== id) throw new Error('knowledge_dependency_unavailable');
  return response.data as Row;
}
async function binding(input: Readonly<BookingFactRequest>, db: Db) {
  const record = await one(db, 'booking_ops_records', input.recordId);
  const accountId = required(record.account_id);
  const propertyId = required(record.property_id);
  const property = await one(db, 'properties', propertyId);
  if (property.account_id !== accountId
    || (input.accountId && input.accountId !== accountId)
    || (input.propertyId && input.propertyId !== propertyId)
    || (input.bookingId && record.booking_id !== input.bookingId)) throw new Error('knowledge_scope_mismatch');
  const metadata = record.reservation_metadata;
  if (metadata && /synthetic|demo|fixture|mock|sample/i.test(JSON.stringify(metadata))) {
    throw new Error('synthetic_booking_knowledge');
  }
  return { scope: { accountId, propertyId, bookingId: input.recordId } as CommunicationFactScope, record };
}
function canonicalFact(record: Row, key: string, scope: CommunicationFactScope): CommunicationFact | null {
  const columns: Record<string, string> = {
    booking_status: 'ops_status', checkin_at: 'check_in_at', checkout_at: 'check_out_at',
    readiness: 'unit_readiness_status', deposit: 'deposit_intake_status', contract: 'contract_intake_status',
  };
  const value = record[columns[key]];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('malformed_booking_fact');
  if (key === 'booking_status' && !(BOOKING_OPS_STATUSES as readonly string[]).includes(value)) {
    throw new Error('unknown_booking_status');
  }
  if (key === 'readiness' && !['ready', 'not_ready', 'in_progress', 'blocked', 'unknown'].includes(value)) {
    throw new Error('unknown_readiness_status');
  }
  if ((key === 'checkin_at' || key === 'checkout_at') && !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid_booking_date');
  }
  const rendered = key === 'booking_status'
    ? 'Подготовка бронирования: ' + BOOKING_OPS_STATUS_LABELS_RU[value as BookingOpsStatus]
    : key === 'checkin_at' ? 'Заезд: ' + value : key === 'checkout_at' ? 'Выезд: ' + value : value;
  return { key, value: rendered, scope: { ...scope }, origin: 'canonical', source: 'booking_ops_records',
    reference: required(record.id), observedAt: required(record.updated_at), verified: true,
    sensitivity: key === 'deposit' || (key === 'booking_status' && value.includes('deposit')) ? 'financial' : key === 'contract' || (key === 'booking_status' && !['created', 'guest_contact_known'].includes(value)) ? 'legal' : 'normal' };
}
/** Canonical persisted Booking Ops data only. Caller snapshots, lifecycle events,
 * questionnaire flags and message metadata cannot serve as evidence. */
export async function prepareBookingCommunication(input: BookingFactRequest, db: Db = supabase, now = Date.now) {
  const request = Object.freeze({ ...input });
  const keys = bookingCommunicationFactKeys(request.purpose);
  try {
    const initial = await readCommunicationDependency(() => binding(request, db));
    const result = await resolveCommunicationFacts({ scope: initial.scope, requestedFacts: keys }, {
      now,
      authorize: async (scope) => sameCommunicationScope(scope, (await binding(request, db)).scope),
      load: async (scope) => {
        const current = await binding(request, db);
        if (!sameCommunicationScope(scope, current.scope)) throw new Error('knowledge_owner_changed');
        const facts: CommunicationFact[] = [];
        for (const key of keys.filter((key) => !propertyKeys.has(key))) {
          const fact = canonicalFact(current.record, key, scope);
          if (fact) facts.push(fact);
        }
        const requested = keys.filter((key) => propertyKeys.has(key));
        if (requested.length) {
          const response = await db.from('object_knowledge_entries').select('*')
            .eq('property_id', scope.propertyId).in('key', requested);
          if (response.error || !Array.isArray(response.data)) throw new Error('knowledge_dependency_unavailable');
          facts.push(...response.data.map((row) => objectKnowledgeFact(row, scope, now())));
        }
        return facts;
      },
    });
    return prepareCommunicationFactReply(result);
  } catch {
    return prepareCommunicationFactReply({ ready: false, decisions: keys.map((key) => ({
      key, use: 'unusable', reason: 'dependency_failed',
    })) });
  }
}
/** Persist only reasons, never evidence values, credentials, guest text or errors. */
export function bookingKnowledgeMetadata(reply: Awaited<ReturnType<typeof prepareBookingCommunication>>) {
  return { knowledge_contract: 'communication-facts-v1', knowledge_summary: reply.summary,
    knowledge_review_required: reply.reviewRequired, operator_review_required: true,
    autoSendEligible: false, actual_send_enabled: false };
}


export async function guardBookingCommunicationDraft(record: {
  id: string; accountId?: string | null; propertyId?: string | null; bookingId?: string | null;
}, purpose: string) {
  const reply = await prepareBookingCommunication({
    recordId: record.id, accountId: record.accountId, propertyId: record.propertyId,
    bookingId: record.bookingId, purpose,
  });
  if (!reply.result.scope) throw new Error('communication_knowledge_scope_unavailable');
  return {
    messageText: reply.text,
    metadata: bookingKnowledgeMetadata(reply),
    status: reply.reviewRequired ? 'waiting_for_external_input' as const : 'draft_ready' as const,
  };
}
