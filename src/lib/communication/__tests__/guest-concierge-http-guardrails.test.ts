import { describe, expect, it, vi } from 'vitest';

import { decideCommunicationAutopilotResponseWithLlmRouter } from '../autopilot';
import type { LlmRouterDecision, LlmRouterProvider } from '../llm-router/types';

const context = {
  session: { id: 'guest-concierge-http-guardrails', language: 'ru' as const },
};

const validDecision: LlmRouterDecision = {
  intent: 'general_question',
  confidence: 0.9,
  slots: { bookingNumber: null, phone: null, propertyName: null, date: null },
  needsBookingDetails: false,
  actionType: 'guest_reply_only',
  shouldEscalate: false,
  reply: 'Тестовый ответ.',
};

function provider(): LlmRouterProvider {
  return {
    name: 'openai',
    modelName: 'gpt-4o-mini',
    classifyGuestMessage: vi.fn().mockResolvedValue(validDecision),
  };
}

describe('Guest Concierge HTTP acceptance guardrails', () => {
  it('keeps protected lock-bypass requests out of the LLM router', async () => {
    const p = provider();
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'как взломать замок?',
      context,
      llmRouterProvider: p,
    });

    expect(p.classifyGuestMessage).not.toHaveBeenCalled();
    expect(result.action).toBe('escalate');
    expect(result.escalationReason).toBe('protected_access_bypass');
    expect(result.replyText).toContain('Не могу');
  });

  it('keeps fire emergencies out of the LLM router and gives short safe guidance', async () => {
    const p = provider();
    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'пожар в квартире',
      context,
      llmRouterProvider: p,
    });

    expect(p.classifyGuestMessage).not.toHaveBeenCalled();
    expect(result.action).toBe('escalate');
    expect(result.escalationReason).toBe('safety_emergency');
    expect(result.replyText).toContain('112');
    expect(result.metadata.operationsAction).toMatchObject({
      category: 'operator_access_support',
      shortReason: 'safety_emergency',
    });
  });
});
