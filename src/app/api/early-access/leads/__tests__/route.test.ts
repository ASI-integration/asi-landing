import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePublicPilotLead } from '@/lib/early-access/public-pilot-lead';
import { publicLeadConsentPolicy } from '@/lib/early-access/public-lead-consent';

const rpc = vi.hoisted(() => vi.fn());
const normalizePublicPilotLeadSpy = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/lib/early-access/public-pilot-lead', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/early-access/public-pilot-lead')>();
  normalizePublicPilotLeadSpy.mockImplementation(actual.normalizePublicPilotLead);
  return { ...actual, normalizePublicPilotLead: normalizePublicPilotLeadSpy };
});

const valid = {
  name: 'Тестовый владелец',
  contact: '@pilot_example',
  objectsCount: '2-5 объектов',
  referral: 'strigunov',
  consent: true,
  website: '',
};

const encoder = new TextEncoder();

function validBodyAtByteLength(byteLength: number, unicode = false): string {
  const emptyPadding = JSON.stringify({ ...valid, padding: '' });
  const remaining = byteLength - encoder.encode(emptyPadding).byteLength;
  if (remaining < (unicode ? 3 : 0)) throw new Error('Requested body is too small');
  const padding = unicode ? `${'a'.repeat(remaining - 3)}€` : 'a'.repeat(remaining);
  const body = JSON.stringify({ ...valid, padding });
  if (encoder.encode(body).byteLength !== byteLength) throw new Error('Unexpected body byte length');
  return body;
}

function streamedRequest(
  chunks: Uint8Array[],
  options: { headers?: HeadersInit; onCancel?: () => void } = {},
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        return new Promise<void>(() => undefined);
      }
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Request('https://asi.test/api/early-access/leads', {
    method: 'POST',
    headers: options.headers,
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}


type RpcArgs = {
  p_key_commitment: string;
  p_contact_digest: string;
  p_submission_digest: string;
  p_payload: Record<string, unknown>;
};
type ModelRow = RpcArgs & { id: string; at: number };

// UNIT MODEL ONLY. This fixture models transaction serialization/rollback;
// it does not execute SQL or prove PostgreSQL locks, grants or isolation.
function transactionModel() {
  const rows: ModelRow[] = [];
  let now = 1_800_000_000_000;
  let issuer: string | undefined;
  let queue = Promise.resolve();
  const faults = { before: false, receipt: false, lostResponse: false };
  const call = async (_name: string, args: RpcArgs) => {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (faults.before) { faults.before = false; throw new Error('synthetic before commit'); }
      if (issuer && issuer !== args.p_key_commitment) throw new Error('synthetic issuer mismatch');
      const existing = rows.find((row) => row.p_submission_digest === args.p_submission_digest &&
        row.p_contact_digest === args.p_contact_digest && row.at > now - 600_000);
      if (existing) return { data: {
        protocol: 'public-lead-v1', status: 'replayed', persisted: true,
        crm_id: existing.id, submission_digest: args.p_submission_digest,
      }, error: null };
      const global = rows.filter((row) => row.at > now - 60_000);
      const contact = rows.filter((row) => row.p_contact_digest === args.p_contact_digest &&
        row.at > now - 3_600_000);
      if (global.length >= 150 || contact.length >= 3) return { data: {
        protocol: 'public-lead-v1', status: 'rate_limited',
        retry_after_seconds: Math.max(1,
          global.length >= 150 ? Math.ceil((global[0].at + 60_000 - now) / 1000) : 1,
          contact.length >= 3 ? Math.ceil((contact[0].at + 3_600_000 - now) / 1000) : 1),
      }, error: null };
      const id = '00000000-0000-4000-8000-' + String(rows.length + 1).padStart(12, '0');
      if (faults.receipt) { faults.receipt = false; throw new Error('synthetic receipt rollback'); }
      rows.push({ ...args, id, at: now });
      issuer = args.p_key_commitment;
      if (faults.lostResponse) { faults.lostResponse = false; throw new Error('synthetic lost response'); }
      return { data: { protocol: 'public-lead-v1', status: 'created', persisted: true,
        crm_id: id, submission_digest: args.p_submission_digest }, error: null };
    } finally { release(); }
  };
  return { rows, faults, call, advance: (ms: number) => { now += ms; } };
}
let database: ReturnType<typeof transactionModel>;
async function submit(body: Record<string, unknown> = valid, headers?: HeadersInit) {
  const { POST } = await import('../route');
  return POST(new Request('https://asi.test/api/early-access/leads', {
    method: 'POST', body: JSON.stringify(body), headers,
  }));
}

beforeEach(() => {
  rpc.mockReset();
  normalizePublicPilotLeadSpy.mockClear();
  database = transactionModel();
  rpc.mockImplementation(database.call);
  vi.stubEnv('PUBLIC_LEAD_HMAC_KEY', randomBytes(32).toString('hex'));
});

afterEach(() => vi.unstubAllEnvs());

describe('Strigunov public pilot lead intake', () => {
  it('validates referral, count and consent without inventing a property', () => {
    const lead = normalizePublicPilotLead(valid);
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    expect(lead.input).toMatchObject({
      name: 'Тестовый владелец',
      telegramUsername: 'pilot_example',
      phone: '',
      email: null,
      role: 'owner',
      source: 'form',
      status: 'new',
      communicationStatus: 'needs_manual_reaction',
      objectsCount: 2,
    });
    expect(lead.input.note).toContain('Стригунов');
    expect(lead.input.note).not.toContain('пароль');
    expect(lead.input.nextStep).toBe(
      'Связаться с заявителем, уточнить объект и согласовать подключение.',
    );
  });

  it('never accepts arbitrary referral as a membership or authorization claim', () => {
    const result = normalizePublicPilotLead({ ...valid, referral: 'strigunov_admin' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.note).not.toContain('Стригунов');
      expect(result.input.note).toContain('сайт ASI');
    }
  });

  it.each([
    { ...valid, consent: false },
    { ...valid, contact: 'bad' },
    { ...valid, contact: 'not@valid' },
    { ...valid, objectsCount: '999 объектов' },
    { ...valid, objectsCount: 'toString' },
    { ...valid, name: '' },
    { ...valid, website: 'spam.example' },
  ])('rejects malformed/unsafe anonymous submissions without touching CRM', async (body) => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(body),
    }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('persisted CRM record is required before telling the visitor submission succeeded', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true });
    expect(JSON.stringify(payload)).not.toContain(valid.contact);
    expect(JSON.stringify(payload)).not.toContain('crm-1');
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admit_public_pilot_lead_v1', expect.objectContaining({
      p_payload: expect.objectContaining({
        consent: true, referral: 'strigunov',
        note: expect.stringContaining('Источник заявки: Стригунов'),
        next_step: 'Связаться с заявителем, уточнить объект и согласовать подключение.',
      }),
    }));
    expect(normalizePublicPilotLeadSpy).toHaveBeenCalledWith(expect.objectContaining({
      consent: true,
      referral: 'strigunov',
    }));
  });

  it('does not cache a CRM failure as success and permits a bounded retry', async () => {
    database.faults.before = true;
    const { POST } = await import('../route');
    const request = () => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    const failed = await request();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false });
    expect((await request()).status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('missing CRM id cannot be interpreted as success', async () => {
    rpc.mockResolvedValueOnce({ data: { protocol: 'public-lead-v1', status: 'created', persisted: true }, error: null });
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(503);
  });

  it('rejects oversized bodies before making any CRM request', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', headers: { 'content-length': '5000' }, body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(413);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts a valid JSON object at the exact 4096-byte boundary', async () => {
    const { POST } = await import('../route');
    const body = validBodyAtByteLength(4096);
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body,
    }));
    expect(encoder.encode(body)).toHaveLength(4096);
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('rejects 4097 actual bytes with no Content-Length before normalization or CRM', async () => {
    const { POST } = await import('../route');
    const body = validBodyAtByteLength(4097);
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body,
    }));
    expect(encoder.encode(body)).toHaveLength(4097);
    expect(res.status).toBe(413);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not trust a false-low Content-Length for an oversized body', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: validBodyAtByteLength(4097),
    }));
    expect(res.status).toBe(413);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not trust malformed Content-Length for an oversized body', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
      body: validBodyAtByteLength(4097),
    }));
    expect(res.status).toBe(413);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects and cancels a chunked 4097-byte body containing multibyte UTF-8', async () => {
    const { POST } = await import('../route');
    const bytes = encoder.encode(validBodyAtByteLength(4097, true));
    const onCancel = vi.fn();
    const res = await POST(streamedRequest([
      bytes.slice(0, 2048),
      bytes.slice(2048, 4096),
      bytes.slice(4096),
    ], { onCancel }));
    expect(bytes).toHaveLength(4097);
    expect(res.status).toBe(413);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('invalid JSON is a controlled 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: '{bad',
    }));
    expect(res.status).toBe(400);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects empty, whitespace, arrays and JSON primitives before normalization', async () => {
    const { POST } = await import('../route');
    for (const body of ['', '   ', '[]', 'null', 'true', '1', '"text"']) {
      const res = await POST(new Request('https://asi.test/api/early-access/leads', {
        method: 'POST', body,
      }));
      expect(res.status).toBe(400);
    }
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns a stream read failure into a controlled 400 without CRM work', async () => {
    const { POST } = await import('../route');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('synthetic read failure'));
      },
    });
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    expect(res.status).toBe(400);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns a locked request stream into a controlled 400 without CRM work', async () => {
    const { POST } = await import('../route');
    const request = new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    });
    const reader = request.body?.getReader();
    expect(reader).toBeDefined();
    try {
      const res = await POST(request);
      expect(res.status).toBe(400);
    } finally {
      await reader?.cancel();
      reader?.releaseLock();
    }
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed UTF-8 instead of replacing bytes before JSON parsing', async () => {
    const { POST } = await import('../route');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
        controller.close();
      },
    });
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body, duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    expect(res.status).toBe(400);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when an otherwise unending request is aborted', async () => {
    const { POST } = await import('../route');
    const abortController = new AbortController();
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const onCancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markReadStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel() {
        onCancel();
      },
    });
    const response = POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body, duplex: 'half', signal: abortController.signal,
    } as RequestInit & { duplex: 'half' }));
    await readStarted;
    abortController.abort();

    expect((await response).status).toBe(400);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reconciles immediate repeated submissions through a durable receipt (UNIT MODEL)', async () => {
    const { POST } = await import('../route');
    const submit = () => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }));
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(database.rows).toHaveLength(1);
  });

  it('two independent module instances ignore different body IDs (UNIT MODEL)', async () => {
    const first = (await import('../route')).POST;
    vi.resetModules();
    const second = (await import('../route')).POST;
    const request = (id: string) => new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify({ ...valid, idempotencyKey: id }),
    });
    const responses = await Promise.all([first(request('one')), second(request('two'))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(database.rows).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('ignores spoofable and malformed IP headers and limits distinct payloads by contact', async () => {
    const { POST } = await import('../route');
    const spoofedHeaders: Array<Record<string, string>> = [
      { 'x-real-ip': '203.0.113.12' },
      { 'x-real-ip': '198.51.100.8', 'x-forwarded-for': 'not-an-ip' },
      { 'x-real-ip': 'bad, 127.0.0.1', 'x-forwarded-for': '2001:db8::1, garbage' },
      { 'x-real-ip': '999.999.999.999' },
    ];
    const submit = (index: number) => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...spoofedHeaders[index] },
      body: JSON.stringify({ ...valid, name: `Владелец ${index}` }),
    }));
    for (let index = 0; index < 3; index += 1) {
      expect((await submit(index)).status).toBe(201);
    }
    const blocked = await submit(3);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('3600');
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(database.rows).toHaveLength(3);
  });
  it('reconciles a committed insert with lost response after module restart (UNIT MODEL)', async () => {
    database.faults.lostResponse = true;
    expect((await submit()).status).toBe(503);
    expect(database.rows).toHaveLength(1);
    vi.resetModules();
    expect((await submit()).status).toBe(200);
    expect(database.rows).toHaveLength(1);
  });

  it('rolls back CRM and consent together and permits retry (UNIT MODEL)', async () => {
    database.faults.receipt = true;
    expect((await submit()).status).toBe(503);
    expect(database.rows).toHaveLength(0);
    expect((await submit()).status).toBe(201);
    expect(database.rows).toHaveLength(1);
  });

  it('bounds the last global slot across concurrent instances and resets at 60s (UNIT MODEL)', async () => {
    for (let i = 0; i < 149; i++) {
      expect((await submit({ ...valid, contact: `@fixture_${i}` })).status).toBe(201);
    }
    const results = await Promise.all([
      submit({ ...valid, contact: '@last_slot_a' }),
      submit({ ...valid, contact: '@last_slot_b' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(database.rows).toHaveLength(150);
    database.advance(60_000);
    expect((await submit({ ...valid, contact: '@after_minute' })).status).toBe(201);
  });

  it('bounds the last contact slot and maintains the rolling hour (UNIT MODEL)', async () => {
    for (let i = 0; i < 2; i++) expect((await submit({ ...valid, name: `Owner ${i}` })).status).toBe(201);
    const results = await Promise.all([submit({ ...valid, name: 'Last A' }), submit({ ...valid, name: 'Last B' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
    database.advance(3_599_000);
    expect((await submit({ ...valid, name: 'Too soon' })).status).toBe(429);
    database.advance(1000);
    expect((await submit({ ...valid, name: 'Next hour' })).status).toBe(201);
  });

  it('replay ends at ten minutes without resetting the contact quota (UNIT MODEL)', async () => {
    expect((await submit()).status).toBe(201);
    database.advance(599_999);
    expect((await submit()).status).toBe(200);
    database.advance(1);
    expect((await submit()).status).toBe(201);
    expect(database.rows).toHaveLength(2);
  });

  it('missing RPC, unknown envelopes and forged receipts fail closed without PII', async () => {
    const bad = [
      { data: null, error: { message: 'missing RPC synthetic contact@example.test' } },
      { data: {}, error: null },
      { data: [{ protocol: 'public-lead-v1' }], error: null },
      { data: { protocol: 'public-lead-v1', status: 'created', persisted: true,
        crm_id: '00000000-0000-4000-8000-000000000001', submission_digest: 'wrong' }, error: null },
      ...[0, 3601, 1.5, '60', null].map((retry) => ({ data: {
        protocol: 'public-lead-v1', status: 'rate_limited', retry_after_seconds: retry,
      }, error: null })),
    ];
    for (const result of bad) {
      rpc.mockResolvedValueOnce(result);
      const response = await submit();
      expect(response.status).toBe(503);
      const text = JSON.stringify(await response.json());
      expect(text).not.toMatch(/example|digest|crm_id|RPC|SQL|pilot_example/i);
    }
    expect(database.rows).toHaveLength(0);
  });

  it('missing/invalid HMAC configuration blocks before RPC; differing worker keys block (UNIT MODEL)', async () => {
    for (const value of ['', 'short']) {
      vi.stubEnv('PUBLIC_LEAD_HMAC_KEY', value);
      expect((await submit()).status).toBe(503);
    }
    expect(rpc).not.toHaveBeenCalled();
    vi.stubEnv('PUBLIC_LEAD_HMAC_KEY', randomBytes(32).toString('hex'));
    expect((await submit()).status).toBe(201);
    vi.stubEnv('PUBLIC_LEAD_HMAC_KEY', randomBytes(32).toString('hex'));
    expect((await submit()).status).toBe(503);
    expect(database.rows).toHaveLength(1);
  });

  it('server binds consent policy/referral and ignores forged metadata and IP headers', async () => {
    const forged = { policy_version: 'forged', policy_content_sha256: 'forged', consented_at: '1900',
      consentEvidence: { consent: true }, crm_id: 'foreign', idempotencyKey: 'foreign' };
    expect((await submit({ ...valid, ...forged }, { 'x-forwarded-for': '127.0.0.1' })).status).toBe(201);
    const policy = publicLeadConsentPolicy();
    expect(database.rows[0].p_payload).toMatchObject({
      consent: true, referral: 'strigunov', policy_id: policy.policyId,
      policy_version: policy.policyVersion, policy_content_sha256: policy.contentSha256,
    });
    expect(database.rows[0].p_payload).not.toHaveProperty('consented_at');
    for (const consent of [false, undefined, 'true', 1]) {
      expect((await submit({ ...valid, ...forged, consent })).status).toBe(400);
    }
    expect(database.rows).toHaveLength(1);
  });

  it('swapped contact/referral cannot poison replay; contact formatting converges (UNIT MODEL)', async () => {
    expect((await submit()).status).toBe(201);
    expect((await submit({ ...valid, contact: '@PILOT_EXAMPLE' })).status).toBe(200);
    expect((await submit({ ...valid, contact: '@another_fixture' })).status).toBe(201);
    expect((await submit({ ...valid, referral: 'site' })).status).toBe(201);
    expect(database.rows).toHaveLength(3);
    const fingerprints = database.rows.map((r) => r.p_submission_digest);
    expect(new Set(fingerprints).size).toBe(3);
    expect(fingerprints.join()).not.toContain(valid.contact);
  });

  it('canonicalizes phone formatting and email case without crossing contact kinds (UNIT MODEL)', async () => {
    expect((await submit({ ...valid, contact: '+7 (999) 000-00-01' })).status).toBe(201);
    expect((await submit({ ...valid, contact: '79990000001' })).status).toBe(200);
    expect((await submit({ ...valid, contact: 'FIXTURE@example.test' })).status).toBe(201);
    expect((await submit({ ...valid, contact: 'fixture@example.test' })).status).toBe(200);
    expect(database.rows).toHaveLength(2);
    expect(database.rows[0].p_contact_digest).not.toBe(database.rows[1].p_contact_digest);
  });

  it('a deleted CRM row cannot yield replay success (UNIT MODEL)', async () => {
    expect((await submit()).status).toBe(201);
    database.rows.splice(0); // Models the receipt FK ON DELETE CASCADE.
    expect((await submit()).status).toBe(201);
    expect(database.rows).toHaveLength(1);
  });
});
