import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePublicPilotLead } from '@/lib/early-access/public-pilot-lead';
import { resetPublicPilotLeadRateLimitForTests } from '@/lib/early-access/public-lead-rate-limit';

const createCrmContact = vi.hoisted(() => vi.fn());
const normalizePublicPilotLeadSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/crm/repository', () => ({ createCrmContact }));
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

beforeEach(() => {
  createCrmContact.mockReset();
  normalizePublicPilotLeadSpy.mockClear();
  resetPublicPilotLeadRateLimitForTests();
});

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
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('persisted CRM record is required before telling the visitor submission succeeded', async () => {
    createCrmContact.mockResolvedValueOnce({ id: 'crm-1', name: valid.name });
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true });
    expect(JSON.stringify(payload)).not.toContain(valid.contact);
    expect(JSON.stringify(payload)).not.toContain('crm-1');
    expect(createCrmContact).toHaveBeenCalledOnce();
    expect(createCrmContact).toHaveBeenCalledWith(expect.objectContaining({
      source: 'form',
      communicationStatus: 'needs_manual_reaction',
      note: expect.stringContaining('Источник заявки: Стригунов'),
      nextStep: 'Связаться с заявителем, уточнить объект и согласовать подключение.',
    }));
    expect(normalizePublicPilotLeadSpy).toHaveBeenCalledWith(expect.objectContaining({
      consent: true,
      referral: 'strigunov',
    }));
  });

  it('does not cache a CRM failure as success and permits a bounded retry', async () => {
    createCrmContact
      .mockRejectedValueOnce(new Error('connection failure'))
      .mockResolvedValueOnce({ id: 'crm-after-retry' });
    const { POST } = await import('../route');
    const request = () => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    const failed = await request();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false });
    expect((await request()).status).toBe(201);
    expect(createCrmContact).toHaveBeenCalledTimes(2);
  });

  it('missing CRM id cannot be interpreted as success', async () => {
    createCrmContact.mockResolvedValueOnce({});
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
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('accepts a valid JSON object at the exact 4096-byte boundary', async () => {
    createCrmContact.mockResolvedValueOnce({ id: 'crm-at-boundary' });
    const { POST } = await import('../route');
    const body = validBodyAtByteLength(4096);
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body,
    }));
    expect(encoder.encode(body)).toHaveLength(4096);
    expect(res.status).toBe(201);
    expect(createCrmContact).toHaveBeenCalledOnce();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('invalid JSON is a controlled 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: '{bad',
    }));
    expect(res.status).toBe(400);
    expect(normalizePublicPilotLeadSpy).not.toHaveBeenCalled();
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
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
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('coalesces immediate repeated submissions without another CRM write', async () => {
    const { POST } = await import('../route');
    createCrmContact.mockResolvedValue({ id: 'crm-1' });
    const submit = () => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }));
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    expect(createCrmContact).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent submissions while the CRM write is in flight', async () => {
    const { POST } = await import('../route');
    let finishWrite: ((value: { id: string }) => void) | undefined;
    createCrmContact.mockImplementationOnce(() => new Promise((resolve) => {
      finishWrite = resolve;
    }));
    const submit = () => POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));

    const first = submit();
    await vi.waitFor(() => expect(createCrmContact).toHaveBeenCalledOnce());
    const second = submit();
    finishWrite?.({ id: 'crm-concurrent' });

    expect((await first).status).toBe(201);
    expect((await second).status).toBe(200);
    expect(createCrmContact).toHaveBeenCalledOnce();
  });

  it('ignores spoofable and malformed IP headers and limits distinct payloads by contact', async () => {
    const { POST } = await import('../route');
    createCrmContact.mockResolvedValue({ id: 'crm-1' });
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
    expect(createCrmContact).toHaveBeenCalledTimes(3);
  });
});
