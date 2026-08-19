import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessEmailInbound = vi.fn();

vi.mock('../email-inbound-processor', () => ({
  processEmailInbound: (...args: unknown[]) => mockProcessEmailInbound(...args),
}));

import {
  processResendInboundWebhook,
  ResendInboundError,
  verifyResendWebhook,
} from '../resend-email-inbound';

const rawKey = Buffer.from('resend-webhook-test-key-32-bytes!!').toString('base64');
const secret = `whsec_${rawKey}`;

function eventBody(type = 'email.received') {
  return JSON.stringify({
    type,
    created_at: '2026-08-19T18:30:00.000Z',
    data: {
      email_id: 'email-123',
      created_at: '2026-08-19T18:29:59.000Z',
      from: 'guest@example.com',
      to: ['support@asi-global.ru'],
      cc: [],
      bcc: [],
      subject: 'Late checkout',
      message_id: '<message-123@example.com>',
      attachments: [],
    },
  });
}

function signedHeaders(rawBody: string, timestamp = '1787164200') {
  const id = 'msg_test_resend_1';
  const key = Buffer.from(rawKey, 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

describe('Resend inbound email bridge', () => {
  beforeEach(() => {
    mockProcessEmailInbound.mockReset();
    mockProcessEmailInbound.mockResolvedValue({
      ok: true,
      reviewId: 'review-email-1',
      outboundMode: 'draft_only',
      orchestrator: { outcome: 'replied', reply: 'Можно обсудить поздний выезд.' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies the raw Svix signature, retrieves full email content, and enters canonical email processing', async () => {
    const rawBody = eventBody();
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'email-123',
          from: 'guest@example.com',
          to: ['support@asi-global.ru'],
          cc: ['manager@example.com'],
          reply_to: ['reply@example.com'],
          subject: 'Late checkout',
          message_id: '<message-123@example.com>',
          created_at: '2026-08-19T18:29:59.000Z',
          text: 'Можно выехать в 15:00?',
          html: '<p>Можно выехать в 15:00?</p>',
          headers: { 'in-reply-to': '<older@example.com>' },
          attachments: [
            {
              id: 'att-1',
              filename: 'photo.jpg',
              content_type: 'image/jpeg',
              content_id: null,
              size: 1234,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await processResendInboundWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      nowMs: 1787164200 * 1000,
      fetchFn: fetchFn as typeof fetch,
      env: {
        RESEND_WEBHOOK_SECRET: secret,
        RESEND_API_KEY: 're_test_key',
        RESEND_API_BASE_URL: 'https://api.resend.com',
      } as NodeJS.ProcessEnv,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, ignored: false, emailId: 'email-123' }),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.resend.com/emails/receiving/email-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_key' }),
      }),
    );
    expect(mockProcessEmailInbound).toHaveBeenCalledTimes(1);
    expect(mockProcessEmailInbound.mock.calls[0][0]).toEqual({
      payload: expect.objectContaining({
        from: 'guest@example.com',
        to: ['support@asi-global.ru'],
        cc: ['manager@example.com'],
        replyTo: ['reply@example.com'],
        subject: 'Late checkout',
        text: 'Можно выехать в 15:00?',
        messageId: '<message-123@example.com>',
        attachments: [
          expect.objectContaining({
            filename: 'photo.jpg',
            contentType: 'image/jpeg',
            size: 1234,
          }),
        ],
      }),
    });
  });

  it('rejects an invalid signature before any provider fetch or canonical processing', async () => {
    const rawBody = eventBody();
    const fetchFn = vi.fn();

    await expect(
      processResendInboundWebhook({
        rawBody,
        headers: {
          ...signedHeaders(rawBody),
          'svix-signature': 'v1,ZmFrZQ==',
        },
        nowMs: 1787164200 * 1000,
        fetchFn: fetchFn as typeof fetch,
        env: {
          RESEND_WEBHOOK_SECRET: secret,
          RESEND_API_KEY: 're_test_key',
        } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({ code: 'invalid_webhook', httpStatus: 401 });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockProcessEmailInbound).not.toHaveBeenCalled();
  });

  it('rejects stale signed webhook replays', () => {
    const rawBody = eventBody();

    expect(() =>
      verifyResendWebhook({
        rawBody,
        headers: signedHeaders(rawBody, '1787160000'),
        nowMs: 1787164200 * 1000,
        env: {
          RESEND_WEBHOOK_SECRET: secret,
          RESEND_WEBHOOK_TOLERANCE_SECONDS: '300',
        } as NodeJS.ProcessEnv,
      }),
    ).toThrowError(ResendInboundError);

    try {
      verifyResendWebhook({
        rawBody,
        headers: signedHeaders(rawBody, '1787160000'),
        nowMs: 1787164200 * 1000,
        env: {
          RESEND_WEBHOOK_SECRET: secret,
          RESEND_WEBHOOK_TOLERANCE_SECONDS: '300',
        } as NodeJS.ProcessEnv,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'stale_webhook', httpStatus: 401 });
    }
  });

  it('accepts a valid non-email event but ignores it without fetching email content', async () => {
    const rawBody = eventBody('email.delivered');
    const fetchFn = vi.fn();

    const result = await processResendInboundWebhook({
      rawBody,
      headers: signedHeaders(rawBody),
      nowMs: 1787164200 * 1000,
      fetchFn: fetchFn as typeof fetch,
      env: {
        RESEND_WEBHOOK_SECRET: secret,
        RESEND_API_KEY: 're_test_key',
      } as NodeJS.ProcessEnv,
    });

    expect(result).toEqual({ ok: true, ignored: true, reason: 'unsupported_event' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockProcessEmailInbound).not.toHaveBeenCalled();
  });

  it('fails closed when the Resend API key is missing', async () => {
    const rawBody = eventBody();

    await expect(
      processResendInboundWebhook({
        rawBody,
        headers: signedHeaders(rawBody),
        nowMs: 1787164200 * 1000,
        env: { RESEND_WEBHOOK_SECRET: secret } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({ code: 'provider_not_configured', httpStatus: 503 });
  });
});
