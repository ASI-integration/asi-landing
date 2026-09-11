import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkTrialExpiration: vi.fn(),
  processMessage: vi.fn(),
  processWhatsAppVoiceWebhook: vi.fn(),
  processPhoneCallEvent: vi.fn(),
  runStayFlowAdvancement: vi.fn(),
  sweepExpiredPaymentSessions: vi.fn(),
}));

vi.mock('@/lib/trial', () => ({ checkTrialExpiration: mocks.checkTrialExpiration }));
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: vi.fn().mockResolvedValue(true),
  sendTelegramMessage: vi.fn(),
}));
vi.mock('@/lib/ops/stay-flow-runner', () => ({
  runStayFlowAdvancement: mocks.runStayFlowAdvancement,
}));
vi.mock('@/lib/communication/session-status', () => ({
  SessionStatus: { Paid: 'paid', Cancelled: 'cancelled' },
  sweepExpiredPaymentSessions: mocks.sweepExpiredPaymentSessions,
  transitionSessionStatus: vi.fn(),
}));
vi.mock('@/lib/communication/orchestrator', () => ({ processMessage: mocks.processMessage }));
vi.mock('@/lib/communication/max-voice-inbound', () => ({ processMaxVoiceUpdate: vi.fn() }));
vi.mock('@/lib/communication/phone-support', () => ({
  processPhoneCallEvent: mocks.processPhoneCallEvent,
}));
vi.mock('@/lib/whatsapp/voice-pipeline', () => ({
  processWhatsAppVoiceWebhook: mocks.processWhatsAppVoiceWebhook,
}));
vi.mock('@/lib/whatsapp/media', () => ({
  fetchWhatsAppMediaMeta: vi.fn(),
  downloadWhatsAppMediaBytes: vi.fn(),
}));
vi.mock('@/lib/whatsapp/stt', () => ({ transcribeWhatsAppAudio: vi.fn() }));

import { GET as checkTrial } from '@/app/api/cron/check-trial/route';
import { POST as whatsappWebhook } from '@/app/api/whatsapp/webhook/route';
import { POST as vkWebhook } from '@/app/api/vk/webhook/route';
import { POST as maxWebhook } from '@/app/api/max/webhook/route';
import { POST as phoneWebhook } from '@/app/api/phone/webhook/route';
import { POST as yookassaWebhook } from '@/app/api/webhooks/yookassa/route';
import { createPaymentRequest } from '@/lib/payments/factory';
import { _resetPaymentDb } from '@/lib/payments/db';
import {
  _resetEventLogs,
  claimPaymentConfirmation,
  claimWebhookEvent,
} from '@/lib/payments/events';
import { _setPaymentsSupabaseForTesting } from '@/lib/payments/supabase';
import { YookassaProvider } from '@/lib/payments/yookassa';

const ENV_KEYS = [
  'CRON_SECRET',
  'WHATSAPP_APP_SECRET',
  'VK_CALLBACK_SECRET',
  'VK_CONFIRMATION_CODE',
  'MAX_WEBHOOK_SECRET',
  'PHONE_WEBHOOK_SECRET',
  'YOOKASSA_ENABLED',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
  _resetPaymentDb();
  _resetEventLogs();
  _setPaymentsSupabaseForTesting(null);
});

describe('Wave 0 protected route boundaries', () => {
  it('rejects check-trial when CRON_SECRET is unset', async () => {
    const response = await checkTrial(new Request('http://localhost/api/cron/check-trial'));

    expect(response.status).toBe(401);
    expect(mocks.checkTrialExpiration).not.toHaveBeenCalled();
    expect(mocks.runStayFlowAdvancement).not.toHaveBeenCalled();
  });

  it('rejects WhatsApp delivery when WHATSAPP_APP_SECRET is unset', async () => {
    const response = await whatsappWebhook(new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(mocks.processWhatsAppVoiceWebhook).not.toHaveBeenCalled();
  });

  it('requires the VK callback secret before returning the confirmation code', async () => {
    process.env.VK_CONFIRMATION_CODE = 'vk-confirmation';
    const withoutSecret = await vkWebhook(new Request('http://localhost/api/vk/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'confirmation', group_id: 7 }),
      headers: { 'Content-Type': 'application/json' },
    }));

    process.env.VK_CALLBACK_SECRET = 'vk-secret';
    const verified = await vkWebhook(new Request('http://localhost/api/vk/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'confirmation', group_id: 7, secret: 'vk-secret' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(withoutSecret.status).toBe(403);
    expect(verified.status).toBe(200);
    expect(await verified.text()).toBe('vk-confirmation');
  });

  it('rejects MAX delivery when MAX_WEBHOOK_SECRET is unset', async () => {
    const response = await maxWebhook(new Request('http://localhost/api/max/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_type: 'message_created' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(mocks.processMessage).not.toHaveBeenCalled();
  });

  it('rejects Phone delivery when PHONE_WEBHOOK_SECRET is unset', async () => {
    const response = await phoneWebhook(new Request('http://localhost/api/phone/webhook', {
      method: 'POST',
      body: JSON.stringify({ event: 'call_missed', call_id: 'call-1' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(mocks.processPhoneCallEvent).not.toHaveBeenCalled();
  });

  it('keeps disabled YooKassa webhooks unavailable', async () => {
    const response = await yookassaWebhook(new Request('http://localhost/api/webhooks/yookassa', {
      method: 'POST',
      body: '{}',
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ received: false, handled: false, status: 'disabled' });
  });

  it('rejects spoofable forwarded IP headers when YooKassa is enabled', async () => {
    process.env.YOOKASSA_ENABLED = 'true';
    const response = await yookassaWebhook(new Request('http://localhost/api/webhooks/yookassa', {
      method: 'POST',
      body: JSON.stringify({ event: 'payment.succeeded', object: { id: 'payment-1' } }),
      headers: { 'X-Forwarded-For': '185.71.76.1' },
    }));

    expect(response.status).toBe(403);
    expect(new YookassaProvider().verifyWebhookSignature('{}', 'anything')).toBe(false);
  });
});

describe('Wave 0 durable payment integrity', () => {
  it('recovers an active payment from Supabase and warms memory after restart', async () => {
    const row = {
      id: 'pay-before-restart',
      provider: 'stripe',
      provider_transaction_id: 'cs-before-restart',
      chat_id: 'chat-42',
      reservation_id: null,
      property_id: null,
      guest_id: null,
      service_type: 'late_checkout',
      amount: 1250,
      currency: 'USD',
      status: 'pending',
      payment_url: 'https://pay.example/existing',
      expires_at: null,
      created_at: '2026-09-10T10:00:00.000Z',
      updated_at: '2026-09-10T10:00:00.000Z',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      query[method] = vi.fn(() => query);
    }
    query.maybeSingle = maybeSingle;
    const from = vi.fn(() => query);
    _setPaymentsSupabaseForTesting({ from } as never);

    const recovered = await createPaymentRequest({ amount: 9999, currency: 'USD', chatId: 'chat-42' });
    const cached = await createPaymentRequest({ amount: 8888, currency: 'USD', chatId: 'chat-42' });

    expect(recovered).toMatchObject({ id: 'pay-before-restart', amount: 1250, status: 'pending' });
    expect(cached.id).toBe('pay-before-restart');
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('deduplicates webhook and confirmation claims through Supabase after memory reset', async () => {
    const durableKeys = new Set<string>();
    const insert = vi.fn(async (row: { dedupe_key: string }) => {
      if (durableKeys.has(row.dedupe_key)) {
        return { error: { code: '23505', message: 'duplicate key' } };
      }
      durableKeys.add(row.dedupe_key);
      return { error: null };
    });
    _setPaymentsSupabaseForTesting({
      from: vi.fn(() => ({ insert })),
    } as never);

    expect(await claimWebhookEvent('stripe', 'evt-1')).toBe(true);
    expect(await claimPaymentConfirmation('pay-1')).toBe(true);

    _resetEventLogs();

    expect(await claimWebhookEvent('stripe', 'evt-1')).toBe(false);
    expect(await claimPaymentConfirmation('pay-1')).toBe(false);
    expect(insert).toHaveBeenCalledTimes(4);
  });

  it('defines a service-role-only durable payment dedupe table', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260911000001_payment_event_dedup.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.payment_event_dedup');
    expect(sql).toContain('dedupe_key TEXT PRIMARY KEY');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.payment_event_dedup FROM anon, authenticated');
  });
});
