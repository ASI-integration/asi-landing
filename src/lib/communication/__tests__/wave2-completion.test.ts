import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
import { prepareBookingCommunication, bookingKnowledgeMetadata, bookingCommunicationFactKeys } from '../booking-knowledge-boundary';
import { conversationalReply, prepareRuntimeKnowledgeReply } from '../knowledge-boundary';
const now = Date.parse('2026-10-01T12:00:00Z');
function fixture() {
  const record: Record<string, unknown> = { id: 'record-a', account_id: 'a', property_id: 'p',
    booking_id: 'booking-a', ops_status: 'created', updated_at: new Date(now).toISOString(),
    check_in_at: '2026-10-02T12:00:00Z', check_out_at: '2026-10-04T10:00:00Z' };
  const property: Record<string, unknown> = { id: 'p', account_id: 'a' };
  const entries: Record<string, unknown>[] = [];
  let fail = '';
  let reads = 0;
  let hook = () => {};
  const db = { from: vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const response = () => {
      reads++;
      if (table === 'object_knowledge_entries') hook();
      const row = table === 'properties' ? property : record;
      return { error: fail === table ? { message: 'password=secret' } : null,
        data: table === 'object_knowledge_entries' ? entries
          : row.id === filters.id ? { ...row } : null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: () => query, limit: () => query, maybeSingle: async () => response(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve) };
    return query;
  }) };
  return { db, record, property, entries, setFail: (v: string) => { fail = v; },
    setHook: (fn: () => void) => { hook = fn; }, getReads: () => reads };
}
const request = { recordId: 'record-a', accountId: 'a', propertyId: 'p', bookingId: 'booking-a',
  purpose: 'neutral_booking_acknowledgement' };
describe('Wave 2 completion: canonical proactive knowledge', () => {
  it('prepares only canonical verified facts as operator drafts, never send permission', async () => {
    const f = fixture();
    const reply = await prepareBookingCommunication(request, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(false);
    expect(reply.text).toContain('Бронь создана');
    expect(bookingKnowledgeMetadata(reply).actual_send_enabled).toBe(false);
    expect(bookingKnowledgeMetadata(reply).operator_review_required).toBe(true);
  });
  it.each(['accountId', 'propertyId', 'bookingId', 'recordId'] as const)('rejects forged %s', async (key) => {
    const f = fixture();
    const reply = await prepareBookingCommunication({ ...request, [key]: 'foreign' }, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(true);
    expect(reply.result.scope).toBeUndefined();
  });
  it('rejects stale booking state', async () => {
    const f = fixture(); f.record.updated_at = new Date(now - 61_000).toISOString();
    const reply = await prepareBookingCommunication(request, f.db as never, () => now);
    expect(reply.result.decisions[0].reason).toBe('stale');
  });
  it.each(['missing', 'synthetic', 'malformed', 'failure'])('rejects %s evidence without leaking errors', async (mode) => {
    const f = fixture();
    if (mode === 'missing') delete f.record.ops_status;
    if (mode === 'synthetic') f.record.reservation_metadata = { synthetic: true };
    if (mode === 'malformed') f.record.ops_status = { forged: true };
    if (mode === 'failure') f.setFail('booking_ops_records');
    const reply = await prepareBookingCommunication(request, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(true);
    expect(JSON.stringify(reply)).not.toContain('password=secret');
  });
  it('rechecks original ownership after property evidence await', async () => {
    const f = fixture(); f.setHook(() => { f.property.account_id = 'b'; f.record.account_id = 'b'; });
    const reply = await prepareBookingCommunication({ ...request, purpose: 'request_arrival_time' }, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(true); expect(reply.result.scope).toBeUndefined();
  });
  it('does not trust a foreign property row or cached evidence', async () => {
    const f = fixture(); f.entries.push({ object_id: 'foreign', property_id: 'foreign', key: 'address' });
    const reply = await prepareBookingCommunication({ ...request, purpose: 'request_arrival_time' }, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(true); expect(reply.text).not.toContain('foreign');
  });
  it.each(['send_checkin_instructions', 'checkout_reminder', 'unit_ready_notice',
    'request_deposit_payment', 'request_contract_confirmation', 'cleaning_assignment', 'new_unknown_purpose'])(
    '%s declares required facts and cannot accept missing evidence', async (purpose) => {
      const f = fixture(); delete f.record.ops_status;
      const reply = await prepareBookingCommunication({ ...request, purpose }, f.db as never, () => now);
      expect(bookingCommunicationFactKeys(purpose).length).toBeGreaterThan(0);
      expect(reply.reviewRequired).toBe(true);
    });
  it('never copies access/payment fields into summaries or drafts', async () => {
    const f = fixture(); f.record.deposit_intake_status = 'secret-card';
    const reply = await prepareBookingCommunication({ ...request, purpose: 'request_deposit_payment' }, f.db as never, () => now);
    expect(reply.reviewRequired).toBe(true);
    expect(JSON.stringify(bookingKnowledgeMetadata(reply))).not.toContain('secret-card');
    expect(reply.text).not.toContain('secret-card');
  });
});
describe('legacy/contextual guest text', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['а завтра?', 'а до скольки?', 'тогда пришлите', 'yes, please', 'можно с собакой?'])(
    '%s cannot fall through to an ungrounded LLM/template', async (message) => {
      expect(conversationalReply(message)).toBeNull();
      const reply = await prepareRuntimeKnowledgeReply({ message, channel: 'email', chatId: 1,
        ru: true, coverUnclassified: true }, fixture().db as never);
      expect(reply?.reviewRequired).toBe(true);
      expect(reply?.result.scope).toBeUndefined();
    });
  it.each(['Привет!', 'Спасибо.', 'hello', 'thank you'])('keeps %s conversational and fact-free', (message) => {
    expect(conversationalReply(message)).toBeTruthy();
  });
});
