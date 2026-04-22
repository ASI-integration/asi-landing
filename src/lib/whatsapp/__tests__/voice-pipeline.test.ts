import { describe, it, expect, beforeEach } from 'vitest';
import { processWhatsAppVoiceWebhook } from '../voice-pipeline';
import type { WhatsAppWebhook } from '../types';
import { _resetForTesting } from '@/lib/communication/idempotency';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '@/lib/communication/operator-review';

function webhookAudio(params: { waId?: string; messageId?: string; mediaId?: string }): WhatsAppWebhook {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '123', phone_number_id: 'pnid-1' },
              contacts: [{ wa_id: params.waId ?? '79001234567', profile: { name: 'Test' } }],
              messages: [
                {
                  from: params.waId ?? '79001234567',
                  id: params.messageId ?? 'wamid.1',
                  timestamp: '1710000000',
                  type: 'audio',
                  audio: { id: params.mediaId ?? 'media-1', mime_type: 'audio/ogg', voice: true },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsApp voice pipeline', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
    process.env.COMM_ESCALATE_CONFIDENCE_THRESHOLD = '0';
  });

  it('ignores non-audio messages', async () => {
    const body: WhatsAppWebhook = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ type: 'text', text: { body: 'hi' }, from: '1', id: 'm1' } as any] } as any }] }],
    };

    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: async () => null,
      downloadMediaBytes: async () => null,
      transcribe: async () => null,
      handleTranscript: async () => ({}),
    });
    expect(r.ok).toBe(true);
    expect((r as any).ignored).toBe('no_audio_message');
  });

  it('dedupes repeated delivery by (waId,messageId) before media/STT', async () => {
    let metaCalls = 0;
    let dlCalls = 0;
    let sttCalls = 0;
    let brainCalls = 0;

    const body = webhookAudio({ waId: '7900', messageId: 'wamid.dup', mediaId: 'media-x' });

    const deps = {
      fetchMediaMeta: async () => {
        metaCalls++;
        return { id: 'media-x', url: 'https://example.test/media', mime_type: 'audio/ogg', file_size: 10 };
      },
      downloadMediaBytes: async () => {
        dlCalls++;
        return new ArrayBuffer(4);
      },
      transcribe: async () => {
        sttCalls++;
        return { transcript: '/start' };
      },
      handleTranscript: async () => {
        brainCalls++;
        return {};
      },
    };

    const r1 = await processWhatsAppVoiceWebhook(body, deps);
    const r2 = await processWhatsAppVoiceWebhook(body, deps);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect((r2 as any).duplicate).toBe(true);
    expect(metaCalls).toBe(1);
    expect(dlCalls).toBe(1);
    expect(sttCalls).toBe(1);
    expect(brainCalls).toBe(1);
  });

  it('fails safely when media metadata fetch fails', async () => {
    const body = webhookAudio({ messageId: 'wamid.meta_fail' });
    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: async () => null,
      downloadMediaBytes: async () => new ArrayBuffer(1),
      transcribe: async () => ({ transcript: 'x' }),
      handleTranscript: async () => ({}),
    });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe('media_meta_failed');
  });

  it('fails safely when STT fails', async () => {
    const body = webhookAudio({ messageId: 'wamid.stt_fail' });
    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: async () => ({ id: 'm', url: 'u' }),
      downloadMediaBytes: async () => new ArrayBuffer(1),
      transcribe: async () => null,
      handleTranscript: async () => ({}),
    });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe('stt_failed');
  });

  it('passes provider ids into transcript handler input', async () => {
    const body = webhookAudio({ waId: '7900', messageId: 'wamid.42', mediaId: 'media-42' });
    let captured: any = null;

    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: async () => ({ id: 'media-42', url: 'u', mime_type: 'audio/ogg' }),
      downloadMediaBytes: async () => new ArrayBuffer(2),
      transcribe: async () => ({ transcript: 'hello' }),
      handleTranscript: async (input) => {
        captured = input;
        return {};
      },
    });

    expect(r.ok).toBe(true);
    expect(captured.channel).toBe('whatsapp_voice');
    expect(captured.actorId).toBe('7900');
    expect(captured.providerMessageId).toBe('wamid.42');
    expect(captured.externalMessageId).toBe('wamid.42');
    expect(captured.providerMediaId).toBe('media-42');
    expect(String(captured.audioRef)).toMatch(/wamid\.42/);
  });

  it('escalation path can create operator review with voice source metadata (integration)', async () => {
    // Use real voice orchestrator + brain (and stub outbound adapter).
    process.env.WHATSAPP_ACCESS_TOKEN = 'test';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test';
    process.env.COMM_OUTBOUND_RETRY_ATTEMPTS = '1';
    process.env.COMM_OUTBOUND_RETRY_BASE_DELAY_MS = '1';
    process.env.TELEGRAM_HTTP_TIMEOUT_MS = '200';

    const fetchOrig = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound.test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const body = webhookAudio({ waId: '7900999', messageId: 'wamid.escalate', mediaId: 'media-e' });

    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: async () => ({ id: 'media-e', url: 'u', mime_type: 'audio/ogg' }),
      downloadMediaBytes: async () => new ArrayBuffer(2),
      transcribe: async () => ({ transcript: 'urgent lock failed, cannot get in, need help now' }),
    });

    expect(r.ok).toBe(true);
    const reviews = listEscalationReviews({ limit: 50 });
    const review = reviews.find(x => x.channel === 'whatsapp_voice' && x.targetId === '7900999');
    expect(review).toBeTruthy();
    expect(review?.source?.source).toBe('voice');
    expect(String(review?.source?.transcript ?? '')).toMatch(/urgent lock failed/i);
    expect(String((review?.source as any)?.providerMessageId ?? '')).toBeTruthy();
    globalThis.fetch = fetchOrig;
  }, 15_000);
});

