import { describe, expect, it, vi } from 'vitest';

import {
  decideGuestCommunicationWithLlmSafeDomainLayer,
  loadCommunicationMemoryFromSession,
  patchCommunicationMemoryFromDecision,
} from '../guest-communication-brain';
import type { LlmSafeDomainProvider } from '../llm-safe-domain-layer';

function lowConfidenceProvider(spy?: ReturnType<typeof vi.fn>): LlmSafeDomainProvider {
  return {
    name: 'openai',
    modelName: 'gpt-mini-test',
    async classifySafeDomain() {
      spy?.();
      return {
        intent: 'unknown',
        domainZone: 'core',
        safeToAnswer: true,
        suggestedReply: 'Не уверена.',
        escalationRequired: false,
        reason: 'ambiguous_or_noisy_input',
        confidence: 0.42,
      };
    },
  };
}

function confidentProvider(reply = 'Поняла вопрос и могу ответить безопасно.'): LlmSafeDomainProvider {
  return {
    name: 'openai',
    modelName: 'gpt-mini-test',
    async classifySafeDomain() {
      return {
        intent: 'guest_general_question',
        domainZone: 'core',
        safeToAnswer: true,
        suggestedReply: reply,
        escalationRequired: false,
        reason: 'semantic_intent_resolved',
        confidence: 0.91,
      };
    },
  };
}

describe('MiniGPT clarification gate', () => {
  it('lets MiniGPT try an unknown non-sensitive message, then asks once when confidence is low', async () => {
    const called = vi.fn();
    const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'эээ... там это... ну...',
      currentIdentity: 'guest',
      conversationMemory: {},
      llmSafeDomainProvider: lowConfidenceProvider(called),
    });

    expect(called).toHaveBeenCalledTimes(1);
    expect(decision.responseMode).toBe('ask_clarifying_question');
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.outcome).toBe('clarification_requested');
    expect(decision.guestTestResult?.intent).toBe('clarification');
    expect(decision.safeGuestReply).toMatch(/повторите/i);
  });

  it('hands off after one recent clarification when MiniGPT still cannot resolve the repeat', async () => {
    const first = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'эээ... там это... ну...',
      currentIdentity: 'guest',
      conversationMemory: {},
      llmSafeDomainProvider: lowConfidenceProvider(),
    });
    const collected = patchCommunicationMemoryFromDecision({
      collectedData: {},
      decision: first,
      messageText: 'эээ... там это... ну...',
      activeRole: 'guest',
    });
    const memory = loadCommunicationMemoryFromSession({
      identity_role: 'guest',
      collected_data: collected,
    });

    const second = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'ну вот это самое...',
      currentIdentity: 'guest',
      conversationMemory: memory,
      llmSafeDomainProvider: lowConfidenceProvider(),
    });

    expect(second.responseMode).toBe('operator_escalation');
    expect(second.shouldEscalate).toBe(true);
    expect(second.outcome).toBe('operator_followup_required');
    expect(second.reason).toBe('guest_intent_still_unclear_after_clarification');
    expect(second.safeGuestReply).toMatch(/оператор/i);
  });

  it('answers on the repeat when MiniGPT resolves the meaning confidently', async () => {
    const memory = {
      awaiting_guest_clarification: true,
      guest_clarification_requested_at: new Date().toISOString(),
    };
    const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'Я спрашиваю про правила проживания.',
      currentIdentity: 'guest',
      conversationMemory: memory,
      llmSafeDomainProvider: confidentProvider('Поняла. Вы спрашиваете про правила проживания.'),
    });

    expect(decision.responseMode).toBe('answer_from_concierge');
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.outcome).toBe('answered_by_concierge_autopilot');
    expect(decision.llmSafeDomain?.used).toBe(true);
  });

  it('does not let an old clarification force an operator handoff', async () => {
    const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'эээ... там это... ну...',
      currentIdentity: 'guest',
      conversationMemory: {
        awaiting_guest_clarification: true,
        guest_clarification_requested_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      },
      llmSafeDomainProvider: lowConfidenceProvider(),
    });

    expect(decision.responseMode).toBe('ask_clarifying_question');
    expect(decision.shouldEscalate).toBe(false);
  });

  it('keeps sensitive requests on immediate deterministic handoff without asking MiniGPT', async () => {
    const called = vi.fn();
    const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'Верните мне деньги за бронирование.',
      currentIdentity: 'guest',
      conversationMemory: {},
      llmSafeDomainProvider: lowConfidenceProvider(called),
    });

    expect(called).not.toHaveBeenCalled();
    expect(decision.responseMode).toBe('operator_escalation');
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.outcome).toBe('operator_followup_required');
  });
});
