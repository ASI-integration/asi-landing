import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePublicPilotLead } from '@/lib/early-access/public-pilot-lead';

const createCrmContact = vi.hoisted(() => vi.fn());
vi.mock('@/lib/crm/repository', () => ({ createCrmContact }));

const valid = {
  name: 'Тестовый владелец',
  contact: '@pilot_example',
  objectsCount: '2-5 объектов',
  referral: 'strigunov',
  consent: true,
  website: '',
};

beforeEach(() => {
  createCrmContact.mockReset();
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
    expect(payload).toEqual({ ok: true, leadId: 'crm-1' });
    expect(JSON.stringify(payload)).not.toContain(valid.contact);
    expect(createCrmContact).toHaveBeenCalledOnce();
    expect(createCrmContact).toHaveBeenCalledWith(expect.objectContaining({
      source: 'form',
      communicationStatus: 'needs_manual_reaction',
    }));
  });

  it('database failure never falsely reports accepted lead', async () => {
    createCrmContact.mockRejectedValueOnce(new Error('connection failure'));
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
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
    expect(createCrmContact).not.toHaveBeenCalled();
  });

  it('invalid JSON is a controlled 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/leads', {
      method: 'POST', body: '{bad',
    }));
    expect(res.status).toBe(400);
  });
});
