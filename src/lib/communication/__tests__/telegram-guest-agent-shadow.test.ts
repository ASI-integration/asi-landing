import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideCommunicationAutopilotResponseWithLlmRouter,
  type CommunicationAutopilotContext,
} from '../autopilot';
import type { LlmRouterDecision, LlmRouterProvider } from '../llm-router/types';

const context: CommunicationAutopilotContext = {
  session: { id: 'shadow-session', language: 'ru' },
};

function decision(input: Partial<LlmRouterDecision> & Pick<LlmRouterDecision, 'intent' | 'reply'>): LlmRouterDecision {
  return {
    confidence: 0.86,
    slots: { bookingNumber: null, phone: null, propertyName: null, date: null },
    needsBookingDetails: true,
    actionType: 'booking_lookup',
    shouldEscalate: false,
    ...input,
  };
}

function shadowProvider(): LlmRouterProvider {
  return {
    name: 'deepseek',
    classifyGuestMessage: vi.fn(async ({ messageText }) => {
      const text = messageText.toLocaleLowerCase('ru-RU');
      if (text.includes('инет')) {
        return decision({
          intent: 'maintenance_issue',
          reply: 'Принял проблему с интернетом. Пришлите объект или номер брони - проверю, что можно сделать.',
        });
      }
      if (text.includes('двери') || text.includes('домофон')) {
        return decision({
          intent: 'access_problem',
          reply: 'Понял, это срочно. Передаю оператору по доступу.',
          actionType: 'access_support',
          shouldEscalate: true,
        });
      }
      if (text.includes('пакет')) {
        return decision({
          intent: 'property_directions',
          reply: 'Подскажу, куда это убрать. Пришлите объект или номер брони - проверю правила.',
        });
      }
      if (text.includes('прошлых жильцов') || text.includes('оставили') || text.includes('чужие вещи')) {
        return decision({
          intent: 'cleaning_issue',
          reply: 'Принял вопрос по уборке. Пришлите объект или номер брони.',
        });
      }
      if (text.includes('обеда') || text.includes('задержаться') || text.includes('выехать после')) {
        return decision({
          intent: 'late_checkout',
          reply: 'Проверю возможность позднего выезда. Пришлите номер брони или объект.',
        });
      }
      if (text.includes('машину') || text.includes('приткнуть') || text.includes('авто')) {
        return decision({
          intent: 'parking_question',
          reply: 'Проверю парковку по вашему объекту. Пришлите номер брони или адрес.',
        });
      }
      if (text.includes('кроватк')) {
        return decision({
          intent: 'general_question',
          reply: 'Уточню по детской кроватке. Пришлите номер брони или объект.',
        });
      }
      if (text.includes('внутр') || text.includes('ключ') || text.includes('войти')) {
        return decision({
          intent: 'checkin_info_request',
          reply: 'Проверю инструкцию по заселению. Пришлите номер брони или объект.',
        });
      }
      return decision({
        intent: 'general_question',
        reply: 'Понял вопрос. Пришлите номер брони или объект - проверю точные данные.',
      });
    }),
  };
}

const CASES: Array<{ phrase: string; expectedAgentIntent: string }> = [
  { phrase: 'интернет умер', expectedAgentIntent: 'wifi_access' },
  { phrase: 'сайты не грузятся', expectedAgentIntent: 'wifi_problem' },
  { phrase: 'куда пакет деть', expectedAgentIntent: 'address_instruction' },
  { phrase: 'тут осталось от прошлых жильцов', expectedAgentIntent: 'cleaning_issue' },
  { phrase: 'мы у двери и не можем войти', expectedAgentIntent: 'urgent_access_problem' },
  { phrase: 'можно задержаться до обеда', expectedAgentIntent: 'early_checkin_late_checkout' },
  { phrase: 'куда машину приткнуть', expectedAgentIntent: 'parking' },
  { phrase: 'ребёнку нужна кроватка', expectedAgentIntent: 'baby_crib_request' },
  { phrase: 'как попасть внутрь', expectedAgentIntent: 'check_in_access' },
  { phrase: 'где взять ключ', expectedAgentIntent: 'check_in_access' },
  { phrase: 'сеть есть но сайты не грузятся', expectedAgentIntent: 'wifi_problem' },
  { phrase: 'куда выбросить коробки', expectedAgentIntent: 'waste_disposal_info' },
  { phrase: 'на полу чужие вещи', expectedAgentIntent: 'cleaning_issue' },
  { phrase: 'домофон молчит', expectedAgentIntent: 'urgent_access_problem' },
  { phrase: 'можно выехать после двенадцати', expectedAgentIntent: 'early_checkin_late_checkout' },
  { phrase: 'где оставить авто', expectedAgentIntent: 'parking' },
  { phrase: 'нужна кровать для малыша', expectedAgentIntent: 'baby_crib_request' },
  { phrase: 'как войти в квартиру', expectedAgentIntent: 'check_in_access' },
];

describe('Telegram Guest Agent shadow mode focused phrases', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(CASES)('builds agent shadow audit draft for "$phrase"', async ({ phrase, expectedAgentIntent }) => {
    vi.stubEnv('TELEGRAM_GUEST_AGENT_MODE', 'shadow');

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: phrase,
      context,
      llmRouterProvider: shadowProvider(),
    });

    expect(result.metadata.guestAgentShadow).toBeDefined();
    expect(result.metadata.guestAgentShadow?.agent.intent).toBe(expectedAgentIntent);
    expect(result.metadata.guestAgentShadow?.agent.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.metadata.guestAgentShadow?.agent.requested_action).toEqual(expect.any(String));
    expect(result.metadata.guestAgentShadow?.agent.required_data).toEqual(expect.any(Array));
    expect(result.metadata.guestAgentShadow?.agent.safe_reply_draft).toEqual(expect.any(String));
    expect(result.metadata.guestAgentShadow?.agent.escalation_needed).toEqual(expect.any(Boolean));
    expect(result.metadata.guestAgentShadow?.mvp_intent).toEqual(expect.any(String));
    expect(result.metadata.guestAgentShadow?.semantic_intent === null || typeof result.metadata.guestAgentShadow?.semantic_intent === 'string').toBe(true);
  });

  it('does not let shadow mode replace the live decision', async () => {
    vi.stubEnv('TELEGRAM_GUEST_AGENT_MODE', 'shadow');

    const result = await decideCommunicationAutopilotResponseWithLlmRouter({
      channel: 'telegram',
      messageText: 'куда машину приткнуть',
      context,
      llmRouterProvider: shadowProvider(),
    });

    expect(result.metadata.guestAgentShadow?.agent.intent).toBe('parking');
    expect(result.metadata.intent).not.toBe(result.metadata.guestAgentShadow?.agent.intent);
  });
});
