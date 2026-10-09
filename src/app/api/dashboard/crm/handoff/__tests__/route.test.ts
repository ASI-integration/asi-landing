import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../route';
import { GET } from '../../queue/route';
import { loadOperatorHandoffs } from '@/lib/crm/operator-handoff-server';
import type { OperatorHandoff } from '@/lib/crm/operator-handoff';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), secret: vi.fn(), rpc: vi.fn(), contacts: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, isSessionSecretConfigured: mocks.secret }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/lib/crm/repository', () => ({ listCrmContacts: mocks.contacts }));
vi.mock('@/lib/crm/activity-feed', () => ({ buildActivityFeed: () => [], buildCardActivities: () => [] }));
vi.mock('@/lib/crm/demo-activity-data', () => ({ demoCrmEventsForFeed: [], shouldUseDemoActivityEvents: () => false }));
vi.mock('@/lib/crm/pilot-rollout', () => ({ computePilotRolloutMetrics: () => ({ limitReached: false }), PILOT_LIMIT_FULL_MESSAGE: '' }));
vi.mock('@/lib/crm/queue-events', () => ({ listCrmEventsByContactIds: async () => ({}), listRecentCrmEventsForFeed: async () => [] }));
vi.mock('@/lib/crm/booking-signals', () => ({ loadCrmBookingSignalsForQueue: async () => [] }));
vi.mock('@/lib/ops-board/repository', () => ({ summarizeOpenOpsTasksByContactIds: async () => ({}) }));
vi.mock('@/lib/crm/queue', () => ({
  CRM_QUEUE_FILTER_VALUES: ['all'], excludeArchivedQueueContacts: (rows: unknown[]) => rows,
  buildQueueItems: (rows: { id: string }[]) => rows.map(({ id }) => ({ id, needsOperator: false,
    referral: 'strigunov', nextAction: 'follow up', nextBestStep: 'review', lastMessagePreview: 'safe' })),
  filterQueueItems: (rows: unknown[]) => rows, groupQueueByColumn: (rows: unknown[]) => ({ new: rows }),
  computeQueueMetrics: () => ({}), buildOperatorInbox: (rows: unknown[]) => rows, emptyQueueColumns: () => ({}),
}));

const C = '10000000-0000-4000-8000-000000000001';
const C2 = '10000000-0000-4000-8000-000000000002';
const A = '30000000-0000-4000-8000-000000000001';
const O = '30000000-0000-4000-8000-000000000002';
const B = '30000000-0000-4000-8000-000000000003';
const key = (n: number) => '20000000-0000-4000-8000-' + n.toString().padStart(12, '0');
type Params = { p_contact_id: string; p_actor_id: string | null; p_action: string;
  p_expected_generation: number; p_idempotency_key: string; p_assignee_id?: string | null; p_backup_id?: string | null };
type Row = { view: OperatorHandoff; assignee: string | null; backup: string | null };
let rows: Map<string, Row>;
let events: Map<string, { fingerprint: string; generation: number }>;
let now: number;
let active: Set<string>;
let ineligible: Set<string>;
let backupQualified: boolean;
let lostResponse: boolean;
const clock = () => new Date(now).toISOString();
const alias = (id: string | null) => id ? 'op-' + id.slice(-12) : null;
const empty = (contactId: string): OperatorHandoff => ({ contactId, status: 'needs_operator', generation: 0,
  assigneeAlias: null, backupAlias: null, assignedAt: null, ackDueAt: null, acknowledgedAt: null,
  escalatedAt: null, closedAt: null, overdue: false, needsOperator: true, reasonCode: 'unassigned' });
const error = (code: string) => ({ data: null, error: { code, message: 'PRIVATE_DB_DIAGNOSTIC' } });

/** UNIT_MODEL fake transaction: assumes serialization; never executes or proves the SQL. */
function fakeRpc(name: string, p: Params & { p_contact_ids?: string[] }) {
  if (name === 'crm_operator_handoff_queue_v1') return { error: null,
    data: p.p_contact_ids!.map((id) => rows.get(id)?.view ?? empty(id)) };
  if (name !== 'crm_operator_handoff_transition_v1') throw new Error('unexpected transport');
  const id = p.p_contact_id;
  if (ineligible.has(id) || ![C, C2].includes(id)) return error('42501');
  if (p.p_action !== 'escalate' && !active.has(p.p_actor_id!)) return error('42501');
  const prior = rows.get(id);
  const h = structuredClone(prior ?? { view: empty(id), assignee: null, backup: null });
  const eventKey = id + ':' + p.p_idempotency_key;
  const fingerprint = JSON.stringify(p);
  const event = events.get(eventKey);
  if (event) return event.fingerprint === fingerprint && event.generation === h.view.generation ?
    { data: { replayed: true, handoff: h.view }, error: null } : error('40001');
  if (h.view.generation !== p.p_expected_generation || h.view.status === 'closed') return error('40001');
  if (['assign', 'reassign', 'close'].includes(p.p_action) && p.p_actor_id !== A) return error('42501');
  if (p.p_action === 'assign' || p.p_action === 'reassign') {
    if (!active.has(p.p_assignee_id!)) return error('42501');
    h.assignee = p.p_assignee_id!;
    h.backup = p.p_backup_id && backupQualified && active.has(p.p_backup_id) ? p.p_backup_id : null;
    h.view = { ...empty(id), generation: h.view.generation, assigneeAlias: alias(h.assignee),
      backupAlias: alias(h.backup), assignedAt: clock(), status: h.backup ? 'assigned' : 'needs_operator',
      ackDueAt: h.backup ? new Date(now + 60000).toISOString() : null,
      reasonCode: h.backup ? 'assigned' : 'backup_unavailable' };
  } else if (p.p_action === 'ack' || p.p_action === 'decline') {
    if (h.assignee !== p.p_actor_id || !['assigned', 'escalated'].includes(h.view.status)) return error('42501');
    if (Date.parse(h.view.ackDueAt!) <= now) return error('40001');
    if (p.p_action === 'ack' && h.view.status === 'assigned' && !active.has(h.backup!)) return error('42501');
    h.view.status = p.p_action === 'ack' ? 'acknowledged' : 'needs_operator';
    h.view.reasonCode = p.p_action === 'ack' ? 'acknowledged' : 'declined';
    h.view.acknowledgedAt = p.p_action === 'ack' ? clock() : null;
    h.view.needsOperator = p.p_action !== 'ack';
  } else if (p.p_action === 'escalate') {
    if (!['assigned', 'escalated'].includes(h.view.status) || Date.parse(h.view.ackDueAt!) > now) return error('40001');
    if (h.backup && active.has(h.backup) && backupQualified) {
      h.assignee = h.backup; h.backup = null;
      h.view.status = 'escalated'; h.view.assigneeAlias = alias(h.assignee); h.view.backupAlias = null;
      h.view.escalatedAt = clock(); h.view.assignedAt = clock(); h.view.ackDueAt = new Date(now + 60000).toISOString();
      h.view.reasonCode = 'backup_takeover';
    } else { h.view.status = 'manual_overdue'; h.view.reasonCode = 'manual_overdue'; }
  } else if (p.p_action === 'close') {
    h.view.status = 'closed'; h.view.closedAt = clock(); h.view.needsOperator = false; h.view.reasonCode = 'resolved';
  }
  h.view.generation = h.view.generation! + 1;
  rows.set(id, h);
  events.set(eventKey, { fingerprint, generation: h.view.generation });
  if (lostResponse) { lostResponse = false; throw new Error('response lost AFTER model commit'); }
  return { data: { replayed: false, handoff: h.view }, error: null };
}

function session(userId = A, email = 'admin@example.invalid') {
  mocks.getSession.mockResolvedValue({ userId, email });
}
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://crm.example.invalid/api/dashboard/crm/handoff', { method: 'POST',
    headers: { Origin: 'https://crm.example.invalid', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body) });
}
const command = (action = 'ack', generation = 1, token = 2, contactId = C) =>
  ({ contactId, action, expectedGeneration: generation, idempotencyKey: key(token) });
const assign = (extra: object = {}) => POST(req({ ...command('assign', 0, 1), assigneeId: O, backupId: B, ...extra }));
const internal = (generation: number, token = 90) => {
  const result = fakeRpc('crm_operator_handoff_transition_v1',
    { p_contact_id: C, p_actor_id: null, p_action: 'escalate', p_expected_generation: generation, p_idempotency_key: key(token) });
  if (Array.isArray(result.data)) throw new Error('unexpected queue receipt');
  return { data: result.data, error: result.error };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRM_OPERATOR_EMAILS', 'admin@example.invalid,operator@example.invalid,backup@example.invalid');
  vi.stubEnv('OPERATOR_EMAIL', '');
  vi.stubEnv('OPS_ADMIN_EMAILS', 'admin@example.invalid');
  vi.stubEnv('CRM_OPERATOR_HANDOFF_MUTATIONS_ENABLED', 'true'); // fake transport only
  rows = new Map(); events = new Map(); active = new Set([A, O, B]); ineligible = new Set();
  now = Date.parse('2026-10-09T00:00:00Z'); backupQualified = true; lostResponse = false;
  mocks.secret.mockReturnValue(true); session();
  mocks.rpc.mockImplementation(fakeRpc); mocks.contacts.mockResolvedValue([{ id: C }]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('UNIT_MODEL private route with fake sessions/serialized RPC; real auth/DB NOT_RUN', () => {
  it('is disabled by default before any service call', async () => {
    vi.stubEnv('CRM_OPERATOR_HANDOFF_MUTATIONS_ENABLED', '');
    expect((await assign()).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns 401 for missing configuration or session before service access', async () => {
    mocks.secret.mockReturnValue(false);
    expect((await assign()).status).toBe(401);
    mocks.secret.mockReturnValue(true); session('');
    expect((await assign()).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires explicit membership even with the development/domain fallback', async () => {
    for (const environment of ['production', 'development']) {
      vi.stubEnv('NODE_ENV', environment); session(A, 'outsider@asi-global.ru');
      expect((await assign()).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed trusted identity, session decoding failure and changed admin identity', async () => {
    session('fake-user'); expect((await assign()).status).toBe(403);
    mocks.getSession.mockRejectedValueOnce(new Error('forged sealed cookie'));
    expect((await assign()).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ userId: A, email: 'admin@example.invalid' })
      .mockResolvedValueOnce({ userId: B, email: 'admin@example.invalid' });
    expect((await assign()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects forged actor, deadline, role and internal escalation without writes', async () => {
    for (const patch of [{ actorId: A }, { ackDueAt: clock() }, { role: 'admin' }, { staffAvailable: true }, { action: 'escalate' }]) {
      expect((await POST(req({ ...command(), ...patch }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects cross-site, missing origin and non-JSON mutation requests', async () => {
    for (const headers of ([{ Origin: 'https://evil.invalid' }, { Origin: '' }, { 'Content-Type': 'text/plain' }] as Record<string, string>[])) {
      expect((await POST(req(command(), headers))).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires the real admin guard and allowlist for assignee and backup choices', async () => {
    session(O, 'operator@example.invalid');
    expect((await assign()).status).toBe(403);
    vi.stubEnv('NODE_ENV', 'development');
    expect((await assign()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes only the session actor; models successful assignment, ACK and closure', async () => {
    expect((await assign()).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBe(A);
    session(O, 'operator@example.invalid');
    const ack = await POST(req(command()));
    expect(await ack.json()).toMatchObject({ ok: true, handoff: { status: 'acknowledged', generation: 2, acknowledgedAt: clock() } });
    expect(mocks.rpc.mock.calls[1][1].p_actor_id).toBe(O);
    session();
    const close = await POST(req({ ...command('close', 2, 3), reasonCode: 'resolved' }));
    expect(await close.json()).toMatchObject({ handoff: { status: 'closed', acknowledgedAt: clock(), closedAt: clock() } });
  });
  it('denies wrong assignee and revoked current operator on every call', async () => {
    await assign(); session(B, 'backup@example.invalid');
    expect((await POST(req(command()))).status).toBe(403);
    session(O, 'operator@example.invalid'); active.delete(O);
    expect((await POST(req(command()))).status).toBe(403);
    expect(rows.get(C)!.view.acknowledgedAt).toBeNull();
  });
  it('models exactly one winner for two concurrent distinct ACK requests', async () => {
    await assign(); session(O, 'operator@example.invalid');
    const results = await Promise.all([POST(req(command('ack', 1, 2))), POST(req(command('ack', 1, 3)))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); expect(events.size).toBe(2);
  });
  it('converges identical idempotency replay but rejects token reuse for a different action', async () => {
    await assign(); session(O, 'operator@example.invalid');
    await POST(req(command())); const replay = await POST(req(command()));
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true }); expect(events.size).toBe(2);
    expect((await POST(req(command('decline')))).status).toBe(409);
  });
  it('rejects stale ACK and stale replay after reassignment', async () => {
    await assign(); session(O, 'operator@example.invalid'); await POST(req(command()));
    session(); await POST(req({ ...command('reassign', 2, 3), assigneeId: B, backupId: O }));
    session(O, 'operator@example.invalid');
    expect((await POST(req(command()))).status).toBe(409);
    expect(rows.get(C)!.view.status).toBe('assigned');
  });
  it('models reassignment racing ACK with CAS: one transition only', async () => {
    await assign(); session(); active.add(A);
    // Admin is also an explicitly assigned operator in this fixture.
    rows.get(C)!.assignee = A; rows.get(C)!.view.assigneeAlias = alias(A);
    const responses = await Promise.all([
      POST(req({ ...command('reassign', 1, 3), assigneeId: B, backupId: O })),
      POST(req(command('ack', 1, 2))),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]); expect(events.size).toBe(2);
  });
  it('models missing/stale/unqualified backup as needs_operator and refuses fake ACK', async () => {
    for (const backupId of [undefined, B]) {
      rows.clear(); events.clear(); backupQualified = false; session();
      expect((await assign({ backupId })).status).toBe(200);
      expect(rows.get(C)!.view).toMatchObject({ status: 'needs_operator', backupAlias: null, ackDueAt: null });
      session(O, 'operator@example.invalid'); expect((await POST(req(command()))).status).toBe(403);
    }
  });
  it('models exact DB clock deadline boundary; client clock has no input channel', async () => {
    await assign(); session(O, 'operator@example.invalid'); now += 60000;
    expect((await POST(req(command()))).status).toBe(409);
    expect(rows.get(C)!.view.acknowledgedAt).toBeNull();
  });
  it('models internal escalation replay, stale old ACK and bounded backup timeout', async () => {
    await assign();
    expect(internal(1).error?.code).toBe('40001'); now += 60000;
    expect(internal(1).data?.handoff.status).toBe('escalated');
    expect(internal(1).data?.replayed).toBe(true); expect(events.size).toBe(2);
    session(O, 'operator@example.invalid'); expect((await POST(req(command()))).status).toBe(409);
    now += 60000; expect(internal(2, 91).data?.handoff.status).toBe('manual_overdue');
    expect(internal(2, 91).data?.replayed).toBe(true);
  });
  it('never claims ACK for a lost commit response; same-key reconciliation does not duplicate', async () => {
    await assign(); session(O, 'operator@example.invalid'); lostResponse = true;
    const lost = await POST(req(command()));
    expect(lost.status).toBe(503); expect(await lost.json()).toEqual({ ok: false, code: 'RECONCILIATION_REQUIRED' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(events.size).toBe(2);
    expect(await (await POST(req(command()))).json()).toMatchObject({ ok: true, replayed: true });
    expect(events.size).toBe(2);
  });
  it('fails closed for absent RPC, null/forged success and transaction failure without diagnostics', async () => {
    for (const result of [error('PGRST202'), error('XX000'), { error: null, data: null },
      { error: null, data: { replayed: false, handoff: { ...empty(C), status: 'acknowledged' } } }]) {
      mocks.rpc.mockResolvedValueOnce(result);
      const response = await assign();
      expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_DB_DIAGNOSTIC');
    }
    expect(rows.size).toBe(0); expect(events.size).toBe(0);
  });
  it('models rollback error and permits a later same-key attempt without invented success', async () => {
    mocks.rpc.mockResolvedValueOnce(error('40001'));
    expect((await assign()).status).toBe(409); expect(rows.size).toBe(0); expect(events.size).toBe(0);
    expect((await assign()).status).toBe(200); expect(events.size).toBe(1);
  });
  it('denies wrong UUID, archived/test contacts; keeps two same-applicant canonical leads separate', async () => {
    expect((await assign({ contactId: 'account-id' })).status).toBe(400);
    for (const label of ['archived', 'test']) {
      ineligible.add(C); expect((await assign()).status, label).toBe(403); ineligible.clear();
    }
    await assign(); await assign({ contactId: C2 });
    expect(rows.size).toBe(2); expect(events.size).toBe(2);
    expect([...rows.keys()]).toEqual([C, C2]);
  });
  it('executes authenticated GET with read-only transport, preserves referral/action and denies anonymous reads', async () => {
    let result = await GET(new Request('https://crm.example.invalid/api/dashboard/crm/queue'));
    expect(result.status).toBe(200);
    expect((await result.json()).items[0]).toMatchObject({ referral: 'strigunov', nextAction: 'follow up',
      nextBestStep: 'review', lastMessagePreview: 'safe', needsOperator: true, operatorHandoff: { status: 'needs_operator' } });
    expect(mocks.rpc.mock.calls.every(([name]) => name === 'crm_operator_handoff_queue_v1')).toBe(true);
    expect(rows.size).toBe(0); expect(events.size).toBe(0);
    vi.clearAllMocks(); session('');
    result = await GET(new Request('https://crm.example.invalid/api/dashboard/crm/queue'));
    expect(result.status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.contacts).not.toHaveBeenCalled();
  });
  it('fails closed on unavailable/malformed queue receipts and preserves decline as unaccepted', async () => {
    for (const result of [error('42P01'), { error: null, data: [{ ...empty(C), assigneeAlias: 'private@example.invalid' }] }]) {
      mocks.rpc.mockResolvedValueOnce(result); expect(await loadOperatorHandoffs([C])).toEqual({});
    }
    await assign(); session(O, 'operator@example.invalid');
    expect(await (await POST(req(command('decline')))).json()).toMatchObject({
      ok: true, handoff: { status: 'needs_operator', acknowledgedAt: null, needsOperator: true },
    });
  });
});
