import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHandoffRequest, parseHandoffProjection, readHandoffBody, withOperatorHandoffs, type OperatorHandoff } from '../operator-handoff';

const contactId = '10000000-0000-4000-8000-000000000001';
const key = '20000000-0000-4000-8000-000000000001';
const sqlFile = '20261009180120_crm_operator_handoff_v1.sql';
const sql = readFileSync('supabase/migrations/' + sqlFile, 'utf8');
const request = { contactId, action: 'ack', expectedGeneration: 1, idempotencyKey: key };
const projection = { contactId, status: 'needs_operator', generation: 0, assigneeAlias: null, backupAlias: null,
  assignedAt: null, ackDueAt: null, acknowledgedAt: null, escalatedAt: null, closedAt: null,
  overdue: false, needsOperator: true, reasonCode: 'unassigned' };

describe('UNIT_MODEL and static source contracts; no PostgreSQL execution', () => {
  it('strictly rejects actor, approval, role, clock, success and malformed identities', () => {
    expect(parseHandoffRequest(request)).toEqual(request);
    for (const key of ['actorId', 'email', 'ownerApproval', 'staffAvailable', 'role', 'ackDueAt', 'success', 'referral']) {
      expect(parseHandoffRequest({ ...request, [key]: 'forged' })).toBeNull();
    }
    for (const contactId of ['account-1', '', '10000000-0000-4000-8000-00000000000z']) {
      expect(parseHandoffRequest({ ...request, contactId })).toBeNull();
    }
    expect(parseHandoffRequest({ ...request, action: 'escalate' })).toBeNull();
    expect(parseHandoffRequest({ ...request, expectedGeneration: 2147483647 })).toBeNull();
    expect(parseHandoffRequest({ ...request, assigneeId: contactId })).toBeNull();
    expect(parseHandoffRequest({ ...request, action: 'assign', assigneeId: contactId, backupId: contactId })).toBeNull();
    expect(parseHandoffRequest({ ...request, action: 'close', reasonCode: 'arbitrary-private-note' })).toBeNull();
  });
  it('uses an explicit PII-free projection and never invents ACK from unavailable data', () => {
    expect(parseHandoffProjection({ ...projection, email: 'private.invalid', notes: 'private', nonce: 'secret' }))
      .toEqual(projection);
    expect(parseHandoffProjection({ ...projection, status: 'acknowledged' })).toBeNull();
    expect(parseHandoffProjection({ ...projection, assigneeAlias: 'real@example.invalid' })).toBeNull();
    expect(parseHandoffProjection({ ...projection, ackDueAt: 'invalid' })).toBeNull();
    expect(parseHandoffProjection({ ...projection, needsOperator: false })).toBeNull();
  });
  it('preserves parent queue contracts and flags both unavailable and unassigned', () => {
    const item = { id: contactId, needsOperator: false, referral: 'strigunov', nextAction: 'call',
      nextBestStep: 'review', lastMessagePreview: 'preview' };
    for (const projections of ([{}, { [contactId]: parseHandoffProjection(projection)! }] as Record<string, OperatorHandoff>[])) {
      const [actual] = withOperatorHandoffs([item], projections);
      expect(actual).toMatchObject({ ...item, needsOperator: true });
      expect(actual.operatorHandoff.acknowledgedAt).toBeNull();
    }
  });
  it('bounds actual UTF-8 body bytes with absent or false Content-Length and cancels', async () => {
    for (const claimedLength of [undefined, '1']) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('я'.repeat(2049))); },
        cancel() { cancelled = true; },
      });
      const req = new Request('https://test.invalid', {
        method: 'POST', body, ...(claimedLength ? { headers: { 'Content-Length': claimedLength } } : {}),
        duplex: 'half',
      } as RequestInit);
      await expect(readHandoffBody(req)).rejects.toThrow('HANDOFF_INVALID');
      expect(cancelled).toBe(true);
    }
    const good = new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(request) });
    expect(await readHandoffBody(good)).toEqual(request);
  });
  it('has one additive ordered migration, canonical contact and genuine staff identity, no seeds', () => {
    const files = readdirSync('supabase/migrations');
    expect(files.filter((name) => name.startsWith(sqlFile.slice(0, 14)))).toEqual([sqlFile]);
    expect(files).toContain('20260619000001_crm_early_access_v1.sql');
    expect(files).toContain('20260622000001_crm_queue_archive.sql');
    expect(sqlFile > '20261006101500_function_search_path_hardening_v1.sql').toBe(true);
    expect(sql).toContain('contact_id uuid PRIMARY KEY REFERENCES public.crm_contacts(id)');
    expect(sql).toContain('user_id uuid PRIMARY KEY REFERENCES public.users(id)');
    expect(sql).toContain('backup_id <> assignee_id');
    expect(sql).not.toMatch(/INSERT INTO public\.crm_operator_handoff_(staff|policy)\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE\s+TABLE|DELETE FROM/i);
  });
  it('statically requires locks, CAS, idempotency and atomic event in the same RPC', () => {
    expect(sql).toContain('WHERE id = p_contact_id FOR UPDATE');
    expect(sql).toContain('WHERE contact_id = p_contact_id FOR UPDATE');
    expect(sql).toContain('ORDER BY user_id FOR SHARE');
    expect(sql).toContain('WHERE contact_id = p_contact_id AND generation = before_generation');
    expect(sql).toContain('UNIQUE (contact_id, idempotency_key)');
    expect(sql).toContain('UNIQUE (contact_id, generation_after)');
    expect(sql).toContain('e.request_fingerprint IS DISTINCT FROM request');
    expect(sql).toContain('e.generation_after IS DISTINCT FROM h.generation');
    expect(sql).toContain('h.assignee_id IS DISTINCT FROM p_actor_id');
    const update = sql.indexOf('UPDATE public.crm_operator_handoffs SET');
    const event = sql.indexOf('INSERT INTO public.crm_operator_handoff_events');
    expect(event).toBeGreaterThan(update);
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN|\bCOMMIT\b/i);
  });
  it('statically denies ineligible contacts and enforces DB clock, active roster and bounded SLA', () => {
    for (const fragment of ['COALESCE(c.crm_archived, false)', "c.source = 'test'", "c.role = 'guest'",
      'acceptance_run|wizard_accept', 'instant := clock_timestamp()', 'instant < h.last_transition_at',
      'h.ack_due_at <= instant', 'h.ack_due_at > instant', "h.state := 'manual_overdue'",
      "h.state := 'needs_operator'", "h.state := 'escalated'", 'BETWEEN 60 AND 86400',
      'policy.enabled IS DISTINCT FROM true', 'actor.active IS DISTINCT FROM true',
      'backup_staff.valid_until >= deadline', 'primary_staff.can_ack IS DISTINCT FROM true']) expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/c\.(role|notes).*='?\s*(admin|operator)/i);
    expect(sql).not.toContain("referral = 'strigunov'");
  });
  it('statically limits privileges, preserves read-only queue and excludes external execution', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(4);
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(4);
    expect(sql.match(/SECURITY INVOKER SET search_path = ''/g)).toHaveLength(4);
    expect(sql).not.toContain('SECURITY DEFINER');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain("current_user <> 'service_role'");
    expect(sql).toContain('HANDOFF_PROVISION_OWNER_ONLY');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.crm_operator_handoff_events');
    expect(sql).toContain('BEFORE TRUNCATE ON public.crm_operator_handoff_events');
    const queueSql = sql.slice(sql.indexOf('CREATE FUNCTION public.crm_operator_handoff_queue_v1'),
      sql.indexOf('CREATE FUNCTION public.crm_operator_handoff_transition_v1'));
    expect(queueSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|PERFORM)\b/);
    const queue = readFileSync('src/app/api/dashboard/crm/queue/route.ts', 'utf8');
    expect(queue.indexOf('requireCrmOperatorSession();')).toBeLessThan(queue.indexOf('loadOperatorHandoffs(contactIds)'));
    expect(queue).toContain('withOperatorHandoffs(baseItems, handoffs)');
    const server = readFileSync('src/lib/crm/operator-handoff-server.ts', 'utf8');
    const route = readFileSync('src/app/api/dashboard/crm/handoff/route.ts', 'utf8');
    expect(server + route).not.toMatch(/\b(fetch|setInterval|setTimeout|sendMessage|sendEmail)\s*\(/);
    expect(server).toContain("CRM_OPERATOR_HANDOFF_MUTATIONS_ENABLED !== 'true'");
  });
});
