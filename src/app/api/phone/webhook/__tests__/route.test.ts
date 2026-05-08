import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessPhoneCallEvent = vi.fn().mockResolvedValue({ ok: true });

vi.mock('@/lib/communication/phone-support', () => ({
  processPhoneCallEvent: (...args: unknown[]) => mockProcessPhoneCallEvent(...args),
}));

describe('Phone webhook route', () => {
  beforeEach(() => {
    mockProcessPhoneCallEvent.mockClear();
    delete process.env.PHONE_WEBHOOK_SECRET;
    delete process.env.PHONE_PROVIDER;
  });

  it('rejects webhook requests with invalid secret', async () => {
    process.env.PHONE_WEBHOOK_SECRET = 'phone-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/phone/webhook', {
      method: 'POST',
      body: JSON.stringify({ event: 'call_missed', call_id: 'call-1' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Phone-Webhook-Secret': 'wrong-secret',
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockProcessPhoneCallEvent).not.toHaveBeenCalled();
  });

  it('ignores unsupported call events safely', async () => {
    process.env.PHONE_WEBHOOK_SECRET = 'phone-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/phone/webhook', {
      method: 'POST',
      body: JSON.stringify({ event: 'provider_ping', call_id: 'call-2' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Phone-Webhook-Secret': 'phone-secret-1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true, reason: 'unsupported_event' });
    expect(mockProcessPhoneCallEvent).not.toHaveBeenCalled();
  });

  it('accepts supported call events quickly for background processing', async () => {
    process.env.PHONE_WEBHOOK_SECRET = 'phone-secret-1';
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/phone/webhook', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'twilio',
        event: 'call_missed',
        CallSid: 'CA111',
        From: '+15550001111',
        To: '+15550002222',
        timestamp: '2026-05-08T10:00:00.000Z',
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer phone-secret-1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, accepted: true, eventType: 'call_missed', providerCallId: 'CA111' });
    expect(mockProcessPhoneCallEvent).toHaveBeenCalledTimes(1);
    expect(mockProcessPhoneCallEvent.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        channel: 'phone',
        provider: 'twilio',
        eventType: 'call_missed',
        providerCallId: 'CA111',
        callerPhoneNumber: '+15550001111',
      }),
    );
  });
});
