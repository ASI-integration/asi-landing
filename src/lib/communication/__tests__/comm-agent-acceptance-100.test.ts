import { describe, expect, it, vi } from 'vitest';
import {
  GUEST_ACCEPTANCE_MATRIX_V1,
  evaluateGuestAcceptanceEntry,
  guestAcceptanceMatrixCount,
  type GuestAcceptanceMatrixEntry,
} from '../guest-acceptance-matrix';
import { decideCommunicationAutopilotResponseWithLlmRouter } from '../autopilot';
import type { LlmRouterDecision, LlmRouterProvider } from '../llm-router/types';

const context = {
  session: { id: 'acceptance-100', language: 'ru' as const },
};

function providerFor(entry: GuestAcceptanceMatrixEntry): LlmRouterProvider {
  const intent = (entry.llm_mock_intent ?? 'unknown') as LlmRouterDecision['intent'];
  const full: LlmRouterDecision = {
    confidence: 0.88,
    intent,
    reply: 'Тестовый ответ для acceptance matrix.',
    slots: { bookingNumber: null, phone: null, propertyName: null, date: null },
    needsBookingDetails: entry.needs_booking_lookup,
    actionType: entry.needs_operator ? 'operator_escalation' : entry.needs_booking_lookup ? 'booking_lookup' : 'guest_reply_only',
    shouldEscalate: entry.needs_operator,
  };
  return {
    name: 'deepseek',
    classifyGuestMessage: vi.fn().mockResolvedValue(full),
  };
}

function isStrictEntry(entry: GuestAcceptanceMatrixEntry): boolean {
  return (
    Boolean(entry.expect_policy_guard) ||
    entry.category === 'access' ||
    entry.category === 'access-code' ||
    entry.id.startsWith('acc-')
  );
}

function deriveAgentFieldsFromAutopilot(autopilot: Awaited<ReturnType<typeof decideCommunicationAutopilotResponseWithLlmRouter>>) {
  return {
    can_auto_reply: autopilot.action === 'auto_reply' && Boolean(autopilot.replyText),
    needs_operator: autopilot.action === 'escalate' || Boolean(autopilot.metadata.urgent),
    needs_booking_lookup: autopilot.metadata.missingContext.length > 0,
  };
}

describe('Guest acceptance matrix v1 (100 phrases)', () => {
  it('contains exactly 100 cases', () => {
    expect(guestAcceptanceMatrixCount()).toBe(100);
    expect(GUEST_ACCEPTANCE_MATRIX_V1.length).toBe(100);
  });

  it.each(GUEST_ACCEPTANCE_MATRIX_V1)('$id [$category]', async (entry) => {
    const p = providerFor(entry);

    const autopilot = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: entry.phrase,
      context,
      llmRouterProvider: p,
    });

    if (entry.expect_llm_called === false) {
      expect(p.classifyGuestMessage).not.toHaveBeenCalled();
    }

    const reply = autopilot.replyText ?? '';
    expect(reply.length).toBeGreaterThan(0);

    for (const forbidden of entry.forbidden_claims) {
      expect(reply.toLocaleLowerCase('ru-RU')).not.toContain(forbidden.toLocaleLowerCase('ru-RU'));
    }

    if (!isStrictEntry(entry)) {
      if (entry.needs_operator) {
        expect(['escalate', 'needs_context']).toContain(autopilot.action);
      }
      if (entry.can_auto_reply === false) {
        expect(autopilot.action).not.toBe('auto_reply');
      }
      return;
    }

    const evalResult = evaluateGuestAcceptanceEntry({
      entry,
      actualIntent: autopilot.metadata.intent,
      actualAction: autopilot.action,
      replyText: reply,
      agent: deriveAgentFieldsFromAutopilot(autopilot),
    });

    expect(evalResult.failures, `${entry.id}: ${evalResult.failures.join('; ')}`).toEqual([]);
  });
});

export async function buildAcceptanceReport(): Promise<
  Array<{
    id: string;
    category: string;
    phrase: string;
    pass: boolean;
    expected: string;
    actual: string;
  }>
> {
  const rows = [];
  for (const entry of GUEST_ACCEPTANCE_MATRIX_V1) {
    const autopilot = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: entry.phrase,
      context,
      llmRouterProvider:
        entry.llm_mock_intent && !entry.expect_policy_guard ? providerFor(entry) : undefined,
    });
    const evalResult = evaluateGuestAcceptanceEntry({
      entry,
      actualIntent: autopilot.metadata.intent,
      actualAction: autopilot.action,
      replyText: autopilot.replyText ?? '',
      agent: deriveAgentFieldsFromAutopilot(autopilot),
    });
    const pass = isStrictEntry(entry) ? evalResult.pass : evalResult.failures.filter((f) => f.startsWith('forbidden')).length === 0;
    rows.push({
      id: entry.id,
      category: entry.category,
      phrase: entry.phrase,
      pass,
      expected: `${entry.expected_intent}/${entry.expected_action}`,
      actual: `${evalResult.actual_intent}/${evalResult.actual_action}`,
    });
  }
  return rows;
}
