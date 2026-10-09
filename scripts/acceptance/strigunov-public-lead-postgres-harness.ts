/**
 * DORMANT acceptance implementation. There is intentionally no installed trusted host.
 * Import/CLI/requestExecution cannot import pg, connect, run SQL, or invoke caller callbacks.
 * Never turn acquireTrustedHost into an env/flag/JSON approval check.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Client, ClientConfig, QueryResultRow } from 'pg';
import { createPlan, cleanupDecision, PINS, SCENARIOS, safeFailure } from './strigunov-public-lead-postgres-contract';
import type { Isolation, JournalPhase } from './strigunov-public-lead-postgres-contract';

type Role = 'service-a' | 'service-b' | 'observer' | 'anon' | 'authenticated';
type Proof = {
  issuerReceipt: string; leaseId: string; targetAlias: string; clusterSystemId: string;
  serverVersion: string; databaseOid: number; databaseNameHash: string; hostBootId: string;
  containerId: string; processOwner: string; networkNamespace: string; egressPolicyReceipt: string;
  emptyDatabaseReceipt: string; schemaSha256: string; migrationSha256: string; applicationSha: string;
  privilegeReceipt: string; rlsReceipt: string; cleanEnvironmentReceipt: string; policyContentSha256: string; expiresAtUtc: string;
  exclusiveDisposable: true; realTargetsExcluded: true; externalActionsDenied: true;
};
type JournalRecord = {
  runId: string; attempt: string; atUtc: string; phase: JournalPhase;
  crmId: string | null; submissionDigest: string; contactDigest: string;
};
type WireFault = 'commit-ack-loss' | 'restart-replay' | 'utc-boundary' | 'crm-receipt-atomicity';
/**
 * Future implementation must live in a separately reviewed trusted host, never caller input.
 * Issuer verifies exact-scope owner/custodian artifacts out of process, attests real cluster,
 * OS/container ownership + egress, and issues an expiring one-use exclusive lease.
 * journal.append must fsync/ack BEFORE returning. Exceptions are fail-closed.
 * Fault host is a privileged isolated-lab controller; no generic "run arbitrary callback".
 */
interface TrustedHost {
  proof: Proof;
  connection(role: Role): Required<Pick<ClientConfig, 'host' | 'port' | 'user' | 'password' | 'database' | 'ssl'>>;
  recheckIdentity(deadlineEpochMs: number): Promise<Proof>;
  journal: { append(record: JournalRecord | Observation, deadlineEpochMs: number): Promise<void> };
  fault: {
    arm(kind: WireFault, context: { runId: string; backendPid: number; submissionDigest: string;
      request: { keyCommitment: string; contactDigest: string; payload: Record<string, unknown> };
      deadlineEpochMs: number }): Promise<string>;
    finish(receipt: string, deadlineEpochMs: number): Promise<{
      verifiedByIssuer: true; kind: WireFault; requestSent: boolean; commitApplied: boolean;
      backendGone: boolean; workerPids: number[]; processStartIds: string[]; utcCrossed: boolean;
      response: Admission | null; noExternalActionsReceipt: string;
    }>;
  };
  terminateOwnedSessions(pids: number[], deadlineEpochMs: number): Promise<{ allGone: true }>;
}
type Admission = {
  protocol: 'public-lead-v1'; status: 'created' | 'replayed' | 'rate_limited';
  crm_id?: string; submission_digest?: string; persisted?: boolean; retry_after_seconds?: number;
};
type Fixture = { contact: string; digest: string; payload: Record<string, unknown> };
type Observation = {
  runId: string; atUtc: string; scenario: string; status: 'OBSERVED' | 'BLOCKED' | 'RECOVERY_REQUIRED';
  facts: Record<string, string | number | boolean | number[]>;
};
const RPC = 'SELECT public.admit_public_pilot_lead_v1($1,$2,$3,$4::jsonb) AS result';
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function requireFact(condition: unknown, category: string): asserts condition {
  if (!condition) throw new Error(category);
}

/** Intentionally absent. No public overload, token factory, env lookup, or injected host. */
async function acquireTrustedHost(): Promise<TrustedHost> {
  throw new Error('TRUSTED_HOST_NOT_INSTALLED');
}
export async function requestExecution(_untrustedInput?: unknown) {
  // Do not access, enumerate, await, stringify or invoke _untrustedInput.
  let host: TrustedHost;
  try { host = await acquireTrustedHost(); } catch {
    return { ...createPlan(), state: 'BLOCKED', reason: 'TRUSTED_HOST_NOT_INSTALLED' };
  }
  return executeOnTrustedHost(host);
}

/** Actual SQL is retained here for later isolated acceptance; this is not a fake driver. */
async function executeOnTrustedHost(host: TrustedHost) {
  let recovery = false;
  async function bounded<T>(operation: Promise<T>, milliseconds = 3000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { recovery = true; reject(new Error('HOST_DEADLINE')); }, milliseconds);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  const original = host.proof;
  function verifyProof(p: Proof) {
    requireFact(/^[a-z0-9_-]{1,64}$/.test(p.targetAlias), 'ALIAS_UNSAFE');
    requireFact(p.exclusiveDisposable && p.realTargetsExcluded && p.externalActionsDenied, 'TARGET_BLOCKED');
    requireFact(p.migrationSha256 === PINS.migrationSha256 && p.applicationSha === PINS.parentSha, 'PIN_MISMATCH');
    requireFact(HEX.test(p.schemaSha256) && HEX.test(p.policyContentSha256) && HEX.test(p.databaseNameHash), 'PROOF_MISSING');
    for (const field of ['issuerReceipt', 'leaseId', 'targetAlias', 'clusterSystemId', 'serverVersion',
      'hostBootId', 'containerId', 'processOwner', 'networkNamespace', 'egressPolicyReceipt',
      'emptyDatabaseReceipt', 'privilegeReceipt', 'rlsReceipt', 'cleanEnvironmentReceipt'] as const) requireFact(p[field], 'PROOF_MISSING');
    requireFact(Number.isSafeInteger(p.databaseOid) && p.databaseOid > 0 &&
      Date.parse(p.expiresAtUtc) > Date.now() + 60_000, 'LEASE_EXPIRED');
  }
  verifyProof(original);
  async function recheckIdentity() {
    const p = await bounded(host.recheckIdentity(Date.now() + 3000)); verifyProof(p);
    requireFact(JSON.stringify(p) === JSON.stringify(original), 'TARGET_CHANGED');
  }
  await recheckIdentity();
  // First possible driver load, after real host issuer. Never reachable in this revision.
  const { Client } = await import('pg');
  const runId = randomUUID();
  const key = randomBytes(32);
  const commitment = createHash('sha256').update(key).digest('hex');
  const hmac = (domain: string, value: string) => createHmac('sha256', key)
    .update(JSON.stringify(['public-lead-v1', domain, value])).digest('hex');
  const clients = new Map<Role, Client>();
  const pids = new Map<Role, number>();
  const failedRoles = new Set<Role>();
  const records: JournalRecord[] = [];
  const observations: Observation[] = [];
  let postgresCalls = 0, cleanupCalls = 0, stopping = false;
  const deadline = Date.now() + 180_000;
  async function sql<T extends QueryResultRow = QueryResultRow>(client: Client, text: string, values: unknown[] = []) {
    requireFact(!stopping && Date.now() < deadline, 'RESOURCE_DEADLINE');
    postgresCalls++;
    return client.query<T>(text, values);
  }
  async function open(role: Role) {
    const cfg = host.connection(role);
    requireFact(cfg.host && cfg.user && cfg.database && typeof cfg.password === 'string' && cfg.password.length > 0 &&
      Number.isInteger(cfg.port) && cfg.port > 0 && cfg.ssl !== undefined, 'CONFIG_INCOMPLETE');
    const connectionConfig = { ...cfg, application_name: 'strigunov-acceptance-' + runId,
      options: '-c statement_timeout=4500 -c lock_timeout=2500 -c idle_in_transaction_session_timeout=8000', connectionTimeoutMillis: 3000, query_timeout: 6000, statement_timeout: 4500,
      lock_timeout: 2500, idle_in_transaction_session_timeout: 8000, keepAlive: true };
    const client = new Client(connectionConfig);
    client.on('error', () => { failedRoles.add(role); }); // Never log connection strings or raw errors.
    clients.set(role, client);
    await client.connect();
    const result = await sql(client, 'SELECT pg_backend_pid() AS pid, current_user AS role, (SELECT oid FROM pg_database WHERE datname=current_database())::int AS oid');
    requireFact(result.rows[0].oid === original.databaseOid, 'DATABASE_CHANGED');
    requireFact(result.rows[0].role === (role.startsWith('service') ? 'service_role' :
      role === 'observer' ? cfg.user : role), 'ROLE_MISMATCH');
    pids.set(role, Number(result.rows[0].pid));
    return client;
  }
  async function observe(scenario: string, facts: Observation['facts'], status: Observation['status'] = 'OBSERVED') {
    const entry = { runId, atUtc: new Date().toISOString(), scenario, status, facts };
    await bounded(host.journal.append(entry, Date.now() + 3000)); observations.push(entry);
  }
  async function phase(record: JournalRecord, value: JournalPhase, id = record.crmId) {
    const next = { ...record, phase: value, crmId: id, atUtc: new Date().toISOString() };
    await bounded(host.journal.append(next, Date.now() + 3000)); Object.assign(record, next);
  }
  function fixture(contactIndex: number, payloadIndex = 0): Fixture {
    const email = 'acceptance-' + runId + '-' + contactIndex + '@example.invalid';
    const payload = {
      name: 'Isolated acceptance fixture', contact_kind: 'email', contact_value: email,
      objects_count: 1, note: 'Synthetic fixture ' + payloadIndex, next_step: 'No external action',
      referral: 'strigunov', consent: true, policy_id: '/ru/privacy', policy_version: PINS.policyVersion,
      policy_source_sha256: PINS.policySourceSha256, policy_content_sha256: original.policyContentSha256,
    };
    return { contact: hmac('contact', JSON.stringify(['email', email])),
      digest: hmac('submission', JSON.stringify(payload)), payload };
  }
  async function intent(f: Fixture) {
    const record: JournalRecord = { runId, attempt: randomUUID(), atUtc: new Date().toISOString(),
      phase: 'INTENT', crmId: null, submissionDigest: f.digest, contactDigest: f.contact };
    await bounded(host.journal.append(record, Date.now() + 3000)); records.push(record); return record;
  }
  async function admission(client: Client, f: Fixture, record: JournalRecord): Promise<Admission> {
    try {
      const r = (await sql(client, RPC, [commitment, f.contact, f.digest, JSON.stringify(f.payload)])).rows[0]?.result as Admission;
      requireFact(r?.protocol === 'public-lead-v1', 'RPC_PROTOCOL');
      if (r.status === 'rate_limited') {
        requireFact(Number.isInteger(r.retry_after_seconds) && r.retry_after_seconds! >= 1 &&
          r.retry_after_seconds! <= 3600, 'RETRY_CONTRACT');
        return r;
      }
      requireFact((r.status === 'created' || r.status === 'replayed') && r.persisted === true &&
        UUID.test(r.crm_id ?? '') && r.submission_digest === f.digest, 'RPC_IDENTITY');
      if (r.status === 'replayed') requireFact(records.some(x => ['IDENTIFIED', 'COMMIT_UNKNOWN', 'COMMITTED'].includes(x.phase) &&
        x.crmId === r.crm_id && x.submissionDigest === f.digest), 'UNOWNED_REPLAY');
      await phase(record, 'IDENTIFIED', r.crm_id!); // durable exact UUID BEFORE COMMIT
      return r;
    } catch (error) {
      await phase(record, 'UNKNOWN'); throw error;
    }
  }
  async function rollback(client: Client, record?: JournalRecord) {
    try {
      await sql(client, 'ROLLBACK');
      if (record) await phase(record, 'ROLLED_BACK');
    } catch {
      recovery = true;
      if (record) await phase(record, 'UNKNOWN');
      throw new Error('RECOVERY_REQUIRED');
    }
  }
  async function commit(client: Client, record: JournalRecord) {
    await phase(record, 'COMMIT_UNKNOWN'); // fsync before request sent, even if acknowledgement is lost
    try { await sql(client, 'COMMIT'); await phase(record, 'COMMITTED'); }
    catch { recovery = true; throw new Error('RECOVERY_REQUIRED'); }
  }
  async function one(client: Client, f: Fixture, isolation: Isolation = 'READ COMMITTED') {
    await sql(client, 'BEGIN ISOLATION LEVEL ' + isolation);
    const record = await intent(f);
    try {
      const result = await admission(client, f, record);
      if (result.status === 'rate_limited') await rollback(client, record);
      else await commit(client, record);
      return { result, record };
    } catch (e) {
      if (record.phase !== 'COMMIT_UNKNOWN') await rollback(client, record);
      throw e;
    }
  }
  let a: Client, b: Client, observer: Client;
  async function counts() {
    return (await sql(observer, 'SELECT (SELECT count(*)::int FROM public.crm_contacts) AS crm, ' +
      '(SELECT count(*)::int FROM public_lead_private.consent_receipts) AS receipts, ' +
      '(SELECT total_created FROM public_lead_private.admission_state WHERE singleton) AS total')).rows[0];
  }
  async function barrier(blockedPid: number, blockerPid: number) {
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      const r = await sql(observer, 'SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS waiting', [blockedPid, blockerPid]);
      if (r.rows[0]?.waiting) return;
    }
    throw new Error('LOCK_BARRIER_NOT_OBSERVED');
  }
  async function race(id: string, fa: Fixture, fb: Fixture, isolation: Isolation, expected: string[]) {
    await sql(a, 'BEGIN ISOLATION LEVEL ' + isolation);
    await sql(b, 'BEGIN ISOLATION LEVEL ' + isolation);
    // Pin B's snapshot before A commits, including at REPEATABLE READ.
    await sql(b, 'SELECT total_created FROM public_lead_private.admission_state WHERE singleton');
    const ra = await intent(fa), rb = await intent(fb);
    const first = await admission(a, fa, ra);
    const pending = admission(b, fb, rb).then(result => ({ result, error: null }),
      error => ({ result: null, error }));
    try { await barrier(pids.get('service-b')!, pids.get('service-a')!); }
    catch (error) { await rollback(a, ra); await pending; await rollback(b, rb); throw error; }
    await commit(a, ra);
    const second = await pending;
    let last: Admission, serialized = false;
    if (second.error) {
      const category = safeFailure(second.error);
      await rollback(b, rb);
      requireFact(isolation === 'REPEATABLE READ' && category === 'SERIALIZATION', 'UNEXPECTED_RACE_FAILURE');
      serialized = true; last = (await one(b, fb, isolation)).result;
    } else {
      last = second.result!;
      if (last.status === 'rate_limited') await rollback(b, rb); else await commit(b, rb);
    }
    requireFact(JSON.stringify([first.status, last.status].sort()) === JSON.stringify([...expected].sort()), 'RACE_RESULT');
    if (fa.digest === fb.digest) requireFact(first.crm_id === last.crm_id, 'DUPLICATE_CRM');
    requireFact(isolation !== 'REPEATABLE READ' || serialized, 'SERIALIZATION_NOT_OBSERVED');
    await observe(id, { backendPids: [pids.get('service-a')!, pids.get('service-b')!],
      lockBarrierObserved: true, serialized, outcomes: [first.status, last.status].join(',') });
  }
  async function expectError(id: string, operation: () => Promise<unknown>, categories: string[]) {
    let category = 'NO_ERROR';
    try { await operation(); } catch (e) { category = safeFailure(e); }
    requireFact(categories.includes(category), 'EXPECTED_FAILURE_NOT_OBSERVED');
    await observe(id, { errorCategory: category });
  }
  async function cleanup() {
    if (recovery || failedRoles.size > 0 || cleanupDecision(records) === 'RECOVERY_REQUIRED') throw new Error('RECOVERY_REQUIRED');
    const owned = [...new Map(records.filter(r => r.phase === 'COMMITTED').map(r => [r.crmId!, r])).values()];
    if (!owned.length) return;
    await recheckIdentity();
    await sql(observer, 'BEGIN');
    try {
      await sql(observer, 'SELECT singleton FROM public_lead_private.admission_state WHERE singleton FOR UPDATE');
      const ids = owned.map(r => r.crmId), digests = owned.map(r => r.submissionDigest), contacts = owned.map(r => r.contactDigest);
      const found = await sql(observer, 'SELECT crm_id, submission_digest, contact_digest FROM public_lead_private.consent_receipts WHERE crm_id = ANY($1::uuid[]) FOR UPDATE', [ids]);
      requireFact(found.rowCount === ids.length && found.rows.every(r => {
        const index = ids.indexOf(r.crm_id);
        return index >= 0 && r.submission_digest === digests[index] && r.contact_digest === contacts[index];
      }), 'CLEANUP_OWNERSHIP_MISMATCH');
      // IDs originate solely from durable journaled RPC receipts in this exclusive empty lab.
      cleanupCalls++;
      const removed = await sql(observer, 'DELETE FROM public.crm_contacts WHERE id = ANY($1::uuid[]) RETURNING id', [ids]);
      requireFact(removed.rowCount === ids.length, 'CLEANUP_COUNT_MISMATCH');
      const left = await sql(observer, 'SELECT (SELECT count(*)::int FROM public.crm_contacts WHERE id=ANY($1::uuid[])) AS crm, ' +
        '(SELECT count(*)::int FROM public_lead_private.consent_receipts WHERE crm_id=ANY($1::uuid[])) AS receipts', [ids]);
      requireFact(left.rows[0].crm === 0 && left.rows[0].receipts === 0, 'CLEANUP_RESIDUE');
      await sql(observer, 'COMMIT');
      const after = await counts();
      requireFact(after.crm === 0 && after.receipts === 0, 'UNOWNED_RESIDUE');
      for (const r of records.filter(r => ids.includes(r.crmId))) await phase(r, 'CLEANED');
      await observe('exact-cleanup', { requested: ids.length, deleted: removed.rowCount!, remaining: 0 });
    } catch { recovery = true; await rollback(observer); throw new Error('RECOVERY_REQUIRED'); }
  }
  try {
    a = await open('service-a'); b = await open('service-b'); observer = await open('observer');
    requireFact(new Set(pids.values()).size === 3, 'SESSIONS_NOT_DISTINCT');
    const initial = await counts();
    requireFact(initial.crm === 0 && initial.receipts === 0 && initial.total === 0, 'LAB_NOT_EMPTY');
    const state = (await sql(observer, 'SELECT key_commitment, last_seen_at::text AS clock FROM public_lead_private.admission_state WHERE singleton')).rows[0];
    requireFact(state.key_commitment === null && state.clock === '-infinity', 'LAB_NOT_PRISTINE');
    const catalog = await sql(observer, "SELECT p.prosecdef, p.provolatile, p.proconfig FROM pg_proc p WHERE p.oid='public.admit_public_pilot_lead_v1(text,text,text,jsonb)'::regprocedure");
    requireFact(catalog.rowCount === 1 && catalog.rows[0].prosecdef === false && catalog.rows[0].provolatile === 'v', 'RPC_CATALOG');
    const rls = await sql(observer, "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public_lead_private' AND c.relname IN ('admission_state','consent_receipts')");
    requireFact(rls.rowCount === 2 && rls.rows.every(row => row.relrowsecurity && row.relforcerowsecurity), 'RLS_NOT_FORCED');
    const acl = (await sql(observer, "SELECT has_function_privilege('anon','public.admit_public_pilot_lead_v1(text,text,text,jsonb)','EXECUTE') AS anon, has_function_privilege('authenticated','public.admit_public_pilot_lead_v1(text,text,text,jsonb)','EXECUTE') AS authenticated, has_function_privilege('service_role','public.admit_public_pilot_lead_v1(text,text,text,jsonb)','EXECUTE') AS service")).rows[0];
    requireFact(acl.anon === false && acl.authenticated === false && acl.service === true, 'RPC_ACL_UNSAFE');
    await observe('target', { targetAlias: original.targetAlias, migrationSha256: PINS.migrationSha256,
      applicationSha: PINS.parentSha,
      issuerReceiptSha256: createHash('sha256').update(original.issuerReceipt).digest('hex'),
      forcedRlsVerified: true, rpcAclVerified: true, backendPids: [...pids.values()], noExternalActions: true });

    for (const isolation of ['READ COMMITTED', 'REPEATABLE READ'] as const) {
      const suffix = isolation === 'READ COMMITTED' ? 'rc' : 'rr';
      await race('same-' + suffix, fixture(1), fixture(1), isolation, ['created', 'replayed']);
      await cleanup();
      await race('different-' + suffix, fixture(2, 1), fixture(2, 2), isolation, ['created', 'created']);
      await cleanup();
      // Quota fixtures stay within one server-minute; if this budget is exceeded, BLOCK.
      const start = Date.now();
      for (let i = 0; i < 149; i++) requireFact((await one(a, fixture(100 + i))).result.status === 'created', 'SEED_FAILED');
      requireFact(Date.now() - start < 40_000, 'QUOTA_WINDOW_EXCEEDED');
      await race('global-quota-' + suffix, fixture(400), fixture(401), isolation, ['created', 'rate_limited']);
      requireFact((await counts()).receipts === 150, 'GLOBAL_QUOTA_COUNT');
      await cleanup();
      await one(a, fixture(500, 1)); await one(a, fixture(500, 2));
      await race('contact-quota-' + suffix, fixture(500, 3), fixture(500, 4), isolation, ['created', 'rate_limited']);
      requireFact((await counts()).receipts === 3, 'CONTACT_QUOTA_COUNT');
      await cleanup();
    }
    // Explicit rollback verifies all three atomic objects, not just the returned JSON.
    const before = await counts(), f = fixture(600);
    await sql(a, 'BEGIN'); const r = await intent(f); await admission(a, f, r); await rollback(a, r);
    requireFact(JSON.stringify(await counts()) === JSON.stringify(before), 'ROLLBACK_LEAK');
    await observe('rollback', { crmDelta: 0, receiptDelta: 0, counterDelta: 0 });

    await sql(a, 'BEGIN'); const interrupted = await intent(f); await admission(a, f, interrupted);
    const oldPid = pids.get('service-a')!; await a.end();
    requireFact((await sql(observer, 'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1', [oldPid])).rows[0].n === 0, 'BACKEND_STILL_ALIVE');
    requireFact(JSON.stringify(await counts()) === JSON.stringify(before), 'DISCONNECT_LEAK');
    await phase(interrupted, 'ROLLED_BACK'); a = await open('service-a');
    const persisted = await one(a, f);
    await observe('pre-commit-disconnect', { oldPid, newPid: pids.get('service-a')!, rolledBack: true });

    const receipt = await sql(observer, 'SELECT r.*, c.email, c.contact, c.source AS crm_source FROM public_lead_private.consent_receipts r JOIN public.crm_contacts c ON c.id=r.crm_id WHERE r.crm_id=$1::uuid', [persisted.result.crm_id]);
    const row = receipt.rows[0];
    requireFact(receipt.rowCount === 1 && row.consent_accepted === true && row.policy_id === '/ru/privacy' &&
      row.policy_version === PINS.policyVersion && row.policy_source_sha256 === PINS.policySourceSha256 &&
      row.policy_content_sha256 === original.policyContentSha256 && row.contact_digest === f.contact &&
      row.submission_digest === f.digest && row.source === 'form' && row.crm_source === 'form' &&
      row.referral === 'strigunov' && row.email === f.payload.contact_value &&
      row.consented_at instanceof Date, 'CONSENT_NOT_PERSISTENT');
    await b.end(); b = await open('service-b');
    requireFact((await one(b, f)).result.crm_id === persisted.result.crm_id, 'RECONNECT_REPLAY_FAILED');
    await observe('consent-persistence', { receiptCount: 1, policySourceSha256: PINS.policySourceSha256,
      policyContentSha256: original.policyContentSha256, reconnected: true });

    for (const role of ['anon', 'authenticated'] as const) {
      const client = await open(role);
      await expectError('role-denial', () => sql(client, RPC, [commitment, f.contact, f.digest, JSON.stringify(f.payload)]), ['PRIVILEGE_DENIED']);
      for (const table of ['admission_state', 'consent_receipts']) await expectError('role-denial',
        () => sql(client, 'SELECT * FROM public_lead_private.' + table + ' LIMIT 1'), ['PRIVILEGE_DENIED']);
      await client.end(); clients.delete(role);
    }
    await expectError('missing-rpc', () => sql(a, 'SELECT public.admit_public_pilot_lead_v1_missing($1::text)', [f.digest]), ['MISSING_RPC']);
    await expectError('key-mismatch', () => sql(a, RPC, ['0'.repeat(64), f.contact, f.digest, JSON.stringify(f.payload)]), ['ADMISSION_REJECTED']);
    for (const payload of [{ ...f.payload, consent: false }, { ...f.payload, consent: undefined },
      { ...f.payload, policy_source_sha256: '0'.repeat(64) }]) {
      await expectError('missing-consent', () => sql(a, RPC, [commitment, f.contact, f.digest, JSON.stringify(payload)]), ['ADMISSION_REJECTED']);
    }
    requireFact((await counts()).crm === 1 && (await counts()).receipts === 1, 'NEGATIVE_WRITE_LEAK');

    await sql(a, 'BEGIN'); await sql(a, 'SELECT singleton FROM public_lead_private.admission_state WHERE singleton FOR UPDATE');
    await sql(b, 'BEGIN'); const timeoutRecord = await intent(fixture(700));
    await expectError('lock-timeout', () => admission(b, fixture(700), timeoutRecord), ['LOCK_TIMEOUT']);
    await rollback(b, timeoutRecord); await rollback(a);
    requireFact((await one(b, fixture(700))).result.status === 'created', 'TIMEOUT_RETRY_FAILED');

    // Real deadlock on namespaced transaction advisory locks; no extra table grants required.
    const lockNamespace = createHash('sha256').update(runId).digest().readInt32BE(0);
    await sql(a, 'BEGIN'); await sql(b, 'BEGIN');
    await sql(a, 'SELECT pg_advisory_xact_lock($1::int,$2::int)', [lockNamespace, 1]);
    await sql(b, 'SELECT pg_advisory_xact_lock($1::int,$2::int)', [lockNamespace, 2]);
    const pa = sql(a, 'SELECT pg_advisory_xact_lock($1::int,$2::int)', [lockNamespace, 2])
      .then(() => 'OK', e => safeFailure(e));
    await barrier(pids.get('service-a')!, pids.get('service-b')!);
    const pb = sql(b, 'SELECT pg_advisory_xact_lock($1::int,$2::int)', [lockNamespace, 1])
      .then(() => 'OK', e => safeFailure(e));
    const outcomes = await Promise.all([pa, pb]);
    await rollback(a); await rollback(b);
    requireFact(outcomes.includes('DEADLOCK'), 'DEADLOCK_NOT_OBSERVED');
    requireFact((await one(b, fixture(750))).result.status === 'created', 'DEADLOCK_RETRY_FAILED');
    await observe('deadlock', { victimCategory: 'DEADLOCK', bothRolledBack: true, retryCreated: true });

    const baseline = await counts();
    for (const [id, update] of [
      ['capacity', 'UPDATE public_lead_private.admission_state SET total_created=100000 WHERE singleton'],
      ['clock-watermark', "UPDATE public_lead_private.admission_state SET last_seen_at=clock_timestamp()+interval '1 day' WHERE singleton"],
    ]) {
      await sql(a, 'BEGIN'); await sql(a, update);
      const fresh = fixture(id === 'capacity' ? 800 : 801), rec = await intent(fresh);
      if (id === 'capacity') await expectError(id, () => admission(a, fresh, rec), ['ADMISSION_REJECTED']);
      else {
        const future = await admission(a, fresh, rec);
        const clock = await sql(a, 'SELECT r.consented_at >= s.last_seen_at AS safe FROM public_lead_private.consent_receipts r CROSS JOIN public_lead_private.admission_state s WHERE r.crm_id=$1::uuid', [future.crm_id]);
        requireFact(clock.rows[0]?.safe === true, 'CLOCK_WATERMARK_FAILED');
        await observe(id, { logicalWatermarkOnly: true, realClockReversalNotClaimed: true });
      }
      await rollback(a, rec);
    }
    requireFact(JSON.stringify(await counts()) === JSON.stringify(baseline), 'BOUNDARY_ROLLBACK_LEAK');

    // Real process/wire/clock/failpoint tests need the future isolated custodian controller.
    // No in-process mock is substituted. Typed receipt alone is insufficient: host issuer verifies it.
    for (const kind of ['commit-ack-loss', 'restart-replay', 'utc-boundary', 'crm-receipt-atomicity'] as const) {
      if (kind === 'utc-boundary') {
        await one(a, fixture(950, 1)); await one(a, fixture(950, 2));
      }
      const fx = kind === 'restart-replay' ? f : kind === 'utc-boundary' ? fixture(950, 3) : fixture(900 + observations.length);
      const beforeFault = await counts();
      if (kind === 'restart-replay') {
        const token = await bounded(host.fault.arm(kind, { runId, backendPid: pids.get('service-a')!, submissionDigest: fx.digest,
          request: { keyCommitment: commitment, contactDigest: fx.contact, payload: fx.payload }, deadlineEpochMs: deadline }), 5000);
        const proof = await bounded(host.fault.finish(token, Date.now() + 15_000), 15_000);
        requireFact(proof.verifiedByIssuer && proof.kind === kind && proof.workerPids.length >= 2 &&
          new Set(proof.workerPids).size >= 2 && new Set(proof.processStartIds).size >= 2 &&
          proof.response?.status === 'replayed' && proof.response.crm_id === persisted.result.crm_id &&
          proof.noExternalActionsReceipt, 'RESTART_NOT_VERIFIED');
        requireFact(JSON.stringify(await counts()) === JSON.stringify(beforeFault), 'RESTART_DUPLICATE');
        await observe(kind, { workerPids: proof.workerPids, verifiedSeparateProcesses: true });
        continue;
      }
      await sql(a, 'BEGIN'); const rec = await intent(fx);
      const token = await bounded(host.fault.arm(kind, { runId, backendPid: pids.get('service-a')!, submissionDigest: fx.digest,
          request: { keyCommitment: commitment, contactDigest: fx.contact, payload: fx.payload }, deadlineEpochMs: deadline }), 5000);
      if (kind === 'crm-receipt-atomicity') {
        await expectError(kind, () => admission(a, fx, rec), ['ADMISSION_REJECTED', 'QUERY_TIMEOUT']);
        await rollback(a, rec);
      } else {
        await admission(a, fx, rec);
        // Any ambiguous outcome stays COMMIT_UNKNOWN until independent backend+row reconciliation.
        await phase(rec, 'COMMIT_UNKNOWN');
        try { await sql(a, 'COMMIT'); } catch { /* expected only after verified custodian wire fault */ }
      }
      const proof = await bounded(host.fault.finish(token, Date.now() + 15_000), 15_000);
      requireFact(proof.verifiedByIssuer && proof.kind === kind && proof.noExternalActionsReceipt, 'FAULT_NOT_VERIFIED');
      if (kind === 'crm-receipt-atomicity') {
        requireFact(!proof.commitApplied && JSON.stringify(await counts()) === JSON.stringify(beforeFault), 'ATOMICITY_LEAK');
      } else {
        requireFact(proof.requestSent && proof.commitApplied && (kind !== 'utc-boundary' || proof.utcCrossed), 'FAULT_OUTCOME_UNKNOWN');
        requireFact(kind !== 'commit-ack-loss' || proof.backendGone, 'FAULT_BACKEND_ALIVE');
        if (kind === 'commit-ack-loss' && proof.backendGone) failedRoles.delete('service-a');
        const found = await sql(observer, 'SELECT crm_id FROM public_lead_private.consent_receipts WHERE crm_id=$1::uuid AND submission_digest=$2 AND contact_digest=$3', [rec.crmId, fx.digest, fx.contact]);
        requireFact(found.rowCount === 1, 'FAULT_RECEIPT_MISSING');
        await phase(rec, 'COMMITTED');
        // Reconnect for retry after lost acknowledgement; no unknown-ID lookup or broad cleanup.
        await a.end().catch(() => undefined); a = await open('service-a');
        const replay = await one(a, fx);
        requireFact(replay.result.status === 'replayed' && replay.result.crm_id === rec.crmId, 'FAULT_RETRY_DUPLICATE');
      }
      if (kind === 'utc-boundary') {
        requireFact((await one(a, fixture(950, 4))).result.status === 'rate_limited', 'UTC_QUOTA_RESET');
      }
      await observe(kind, { issuerVerifiedFault: true, requestSent: proof.requestSent, commitApplied: proof.commitApplied });
    }
    // Every required scenario must have observations; they remain unaccepted until external review.
    await cleanup();
    requireFact(SCENARIOS.every(s => observations.some(o => o.scenario === s.id && o.status === 'OBSERVED')), 'SCENARIO_MISSING');
    await observe('complete', { independentReviewRequired: true });
    return { state: 'BLOCKED', verdict: 'BLOCK', databaseAccepted: false,
      reason: 'INDEPENDENT_ACCEPTANCE_RECEIPT_NOT_IMPLEMENTED', runId, postgresCalls, cleanupCalls, observations };
  } catch (error) {
    recovery ||= failedRoles.size > 0 || cleanupDecision(records) === 'RECOVERY_REQUIRED';
    // Never initiate cleanup on an uncertain outcome; retain the durable recovery journal.
    await observe('halt', { errorCategory: safeFailure(error), cleanupProhibited: true },
      recovery ? 'RECOVERY_REQUIRED' : 'BLOCKED');
    return { state: recovery ? 'RECOVERY_REQUIRED' : 'BLOCKED', verdict: 'BLOCK', databaseAccepted: false,
      reason: 'ACCEPTANCE_INCOMPLETE', runId, postgresCalls, cleanupCalls, observations };
  } finally {
    stopping = true;
    // Trusted host must kill ONLY lease-owned backends within its deadline before releasing target.
    // Do not use Promise.race to abandon a still-writing SQL request and then clean its rows.
    try {
      const stopped = await bounded(host.terminateOwnedSessions([...pids.values()], Date.now() + 5000), 5000);
      requireFact(stopped.allGone === true, 'BACKEND_TERMINATION_UNVERIFIED');
      await bounded(Promise.allSettled([...clients.values()].map(c => c.end())));
    } finally { key.fill(0); }
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  // All flags are deliberately non-executing, including --execute and --dry-run.
  const output = process.argv.length > 2
    ? { ...createPlan(), state: 'BLOCKED', reason: 'TRUSTED_HOST_NOT_INSTALLED' } : createPlan();
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = 2;
}
