import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideCommunicationAutopilotResponseWithLlmRouter,
  type CommunicationAutopilotContext,
} from '../autopilot';
import { classifyWithConfiguredLlmRouter, __resetLlmRouterStickyProvidersForTests } from '../llm-router/provider';
import {
  safeCheckinCodeRequestReply,
  safeLlmRouterFallbackReply,
  validateLlmRouterDecision,
} from '../llm-router/validate-llm-router-decision';
import type { LlmRouterDecision, LlmRouterProvider } from '../llm-router/types';

const context: CommunicationAutopilotContext = {
  session: { id: '42', language: 'ru' },
};

const validDecision: LlmRouterDecision = {
  intent: 'checkin_code_request',
  confidence: 0.91,
  slots: {
    bookingNumber: null,
    phone: null,
    propertyName: null,
    date: null,
  },
  needsBookingDetails: true,
  actionType: 'booking_lookup',
  shouldEscalate: false,
  reply: 'Пришлите номер брони или телефон, указанный при бронировании.',
};

const MOJIBAKE_PATTERN = /(?:Ð|Ñ|�|вЂ|Р[°±µ¶·»¼½їёѕјџҐґ]|С[‚ѓ„…†‡€ЃЌЏ‘’“”•–—™љњќћџ])/;

function expectReadableRussian(text: string): void {
  expect(text).not.toMatch(MOJIBAKE_PATTERN);
}

function provider(decision: unknown): LlmRouterProvider {
  return {
    name: 'deepseek',
    classifyGuestMessage: vi.fn().mockImplementation(async () => {
      if (decision instanceof Error) throw decision;
      return decision as LlmRouterDecision;
    }),
  };
}

function chatResponse(content: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({
      choices: [
        {
          message: {
            content: typeof content === 'string' ? content : JSON.stringify(content),
          },
        },
      ],
    }),
  } as Response;
}

describe('Telegram LLM router autopilot fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetLlmRouterStickyProvidersForTests();
  });

  it('keeps safe guest-facing router replies readable Russian', () => {
    expectReadableRussian(safeLlmRouterFallbackReply());
    expectReadableRussian(safeCheckinCodeRequestReply());
    expect(safeCheckinCodeRequestReply()).toContain('номер брони');
    expect(safeCheckinCodeRequestReply()).toContain('телефон');
  });

  it('rejects unsafe booking and access-code claims in readable Russian', () => {
    expect(validateLlmRouterDecision({ ...validDecision, reply: 'Код доступа есть и действует.' })).toMatchObject({
      ok: false,
      reason: 'unsafe_reply',
    });
    expect(validateLlmRouterDecision({ ...validDecision, reply: 'Бронь подтверждена.' })).toMatchObject({
      ok: false,
      reason: 'unsafe_reply',
    });
  });

  it('rejects non-escalated router decisions for urgent Russian access text', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('LLM_ROUTER_MAX_PROVIDER_ATTEMPTS', '1');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(chatResponse(validDecision));

    const result = await classifyWithConfiguredLlmRouter({
      messageText: 'Стою у двери, код не работает',
      lang: 'ru',
      sessionId: 'tg-urgent-access',
    });

    expect(result.ok).toBe(false);
    expect(result.attempts.some((attempt) => attempt.failureReason === 'urgent_access_not_escalated')).toBe(true);
  });

  it('calls LLM router for unknown low-confidence canon path', async () => {
    const p = provider(validDecision);
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
      llmRouterProvider: p,
    });

    expect(p.classifyGuestMessage).toHaveBeenCalledOnce();
    expect(result.metadata.llmRouter?.validation).toBe('accepted');
  });

  it('turns a valid LLM check-in code decision into the safe final reply', async () => {
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
      llmRouterProvider: provider(validDecision),
    });

    expect(result.action).toBe('needs_context');
    expect(result.metadata.intent).toBe('checkin_code_request');
    expect(result.metadata.operationsAction).toBeUndefined();
    expect(result.replyText).toBe(
      'Да, помогу. Пришлите номер брони или телефон, указанный при бронировании, и я проверю данные для заселения.',
    );
  });

  it('falls back safely when provider cannot parse invalid JSON', async () => {
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
      llmRouterProvider: provider(new Error('invalid_json')),
    });

    expect(result.action).toBe('needs_context');
    expect(result.metadata.intent).toBe('unknown');
    expect(result.metadata.llmRouter?.validation).toBe('provider_failed');
  });

  it('falls back safely on invalid enum values', async () => {
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
      llmRouterProvider: provider({ ...validDecision, intent: 'invent_code' }),
    });

    expect(result.action).toBe('needs_context');
    expect(result.metadata.intent).toBe('unknown');
    expect(result.metadata.llmRouter?.validation).toBe('rejected');
  });

  it('does not act automatically below confidence threshold', async () => {
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
      llmRouterProvider: provider({ ...validDecision, confidence: 0.62 }),
    });

    expect(result.action).toBe('needs_context');
    expect(result.metadata.intent).toBe('unknown');
    expect(result.metadata.llmRouter?.validation).toBe('low_confidence');
    expect(result.replyText).toBe(
      'Поняла. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.',
    );
  });

  it('does not call LLM router for direct canon check-in code request', async () => {
    const p = provider(validDecision);
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'если есть номер брони, я смогу получить одноразовый код для заселения?',
      context,
      llmRouterProvider: p,
    });

    expect(p.classifyGuestMessage).not.toHaveBeenCalled();
    expect(result.metadata.intent).toBe('checkin_code_request');
    expect(result.action).toBe('needs_context');
    expect(result.metadata.operationsAction).toBeUndefined();
  });

  it('still escalates urgent access through policy', async () => {
    const p = provider(validDecision);
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'стою у двери, код не работает',
      context,
      llmRouterProvider: p,
    });

    expect(p.classifyGuestMessage).not.toHaveBeenCalled();
    expect(result.action).toBe('escalate');
    expect(result.metadata.intent).toBe('urgent_access_problem');
    expect(result.metadata.operationsAction?.category).toBe('operator_access_support');
  });

  it('auto-fails over from invalid DeepSeek JSON to OpenAI nano', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_AUTO_FALLBACK_ENABLED', 'true');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_SECONDARY_PROVIDER', 'openai');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(chatResponse('{bad json'))
      .mockResolvedValueOnce(chatResponse(validDecision));

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.metadata.intent).toBe('checkin_code_request');
    expect(result.metadata.llmRouter?.provider).toBe('openai');
    expect(result.metadata.llmRouter?.attempts?.map((attempt) => attempt.marker)).toContain('LLM_ROUTER_PRIMARY_FAILED');
  });

  it('auto-fails over from low DeepSeek confidence to OpenAI nano', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_SECONDARY_PROVIDER', 'openai');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(chatResponse({ ...validDecision, confidence: 0.42 }))
      .mockResolvedValueOnce(chatResponse(validDecision));

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.metadata.llmRouter?.provider).toBe('openai');
    expect(result.replyText).toBe(
      'Да, помогу. Пришлите номер брони или телефон, указанный при бронировании, и я проверю данные для заселения.',
    );
  });

  it('auto-fails over from DeepSeek timeout to OpenAI nano', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_SECONDARY_PROVIDER', 'openai');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('AbortError'))
      .mockResolvedValueOnce(chatResponse(validDecision));

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.metadata.llmRouter?.provider).toBe('openai');
  });

  it('fixed mode uses only the configured provider', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'fixed');
    vi.stubEnv('LLM_ROUTER_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(chatResponse('{bad json'));

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata.intent).toBe('unknown');
    expect(result.replyText).toBe(
      'Поняла. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.',
    );
  });

  it('keeps the successful secondary provider sticky for the session', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_SECONDARY_PROVIDER', 'openai');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(chatResponse('{bad json'))
      .mockResolvedValueOnce(chatResponse(validDecision))
      .mockResolvedValueOnce(chatResponse(validDecision));

    await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context,
    });
    const second = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите еще по этому вопросу',
      context,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(second.metadata.llmRouter?.attempts?.[0]?.marker).toBe('LLM_ROUTER_STICKY_PROVIDER_USED');
    expect(second.metadata.llmRouter?.provider).toBe('openai');
  });

  it('does not reuse sticky provider across different bookings in the same session', async () => {
    vi.stubEnv('LLM_ROUTER_MODE', 'auto');
    vi.stubEnv('LLM_ROUTER_PRIMARY_PROVIDER', 'deepseek');
    vi.stubEnv('LLM_ROUTER_SECONDARY_PROVIDER', 'openai');
    vi.stubEnv('LLM_ROUTER_MAX_RETRIES', '0');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(chatResponse('{bad json'))
      .mockResolvedValueOnce(chatResponse(validDecision))
      .mockResolvedValueOnce(chatResponse(validDecision));

    await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите пожалуйста по моему вопросу',
      context: { ...context, booking: { id: 'booking-a' } },
    });
    const second = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'подскажите еще по этому вопросу',
      context: { ...context, booking: { id: 'booking-b' } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(second.metadata.llmRouter?.attempts?.[0]?.marker).toBe('LLM_ROUTER_PRIMARY_USED');
    expect(second.metadata.llmRouter?.provider).toBe('deepseek');
  });
});
