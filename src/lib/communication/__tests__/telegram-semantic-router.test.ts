import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideCommunicationAutopilotResponse } from '../autopilot';
import {
  classifyTelegramGuestSemanticDeterministic,
  mapSemanticRouterToAutopilotIntent,
  routeTelegramGuestSemantic,
  validateTelegramSemanticRouterResult,
} from '../telegram-semantic-router';
import type { TelegramSemanticRouterProvider } from '../telegram-semantic-router/types';

describe('Telegram semantic router deterministic', () => {
  it('различает Wi-Fi access и Wi-Fi problem', () => {
    const access = classifyTelegramGuestSemanticDeterministic('какой пароль от вайфая?');
    const problem = classifyTelegramGuestSemanticDeterministic('интернет в квартире совсем не работает');

    expect(access.intent).toBe('wifi_access');
    expect(access.is_problem).toBe(false);
    expect(access.requested_secret).toBe(true);

    expect(problem.intent).toBe('wifi_problem');
    expect(problem.is_problem).toBe(true);
    expect(problem.slots.problem_type).toBe('internet_not_working');
  });

  it('различает мусорные баки и проблему уборки', () => {
    const waste = classifyTelegramGuestSemanticDeterministic('куда выносить мусор в этом доме?');
    const cleaning = classifyTelegramGuestSemanticDeterministic('в номере грязно и мусор не вывезли');
    const leftover = classifyTelegramGuestSemanticDeterministic('мусор остался от прошлых гостей');

    expect(waste.intent).toBe('waste_disposal_info');
    expect(waste.topic).toBe('waste');
    expect(cleaning.intent).toBe('cleaning_issue');
    expect(cleaning.topic).toBe('cleaning');
    expect(leftover.intent).toBe('cleaning_issue');
    expect(leftover.is_problem).toBe(true);
    expect(leftover.topic).toBe('cleaning');
  });

  it('различает поздний выезд и общий вопрос про checkout', () => {
    const late = classifyTelegramGuestSemanticDeterministic('можно позже выехать?');
    const checkout = classifyTelegramGuestSemanticDeterministic('до скольки выезд?');

    expect(late.intent).toBe('early_checkin_late_checkout');
    expect(late.topic).toBe('checkout');
    expect(late.is_problem).toBe(false);
    expect(late.needs_booking_context).toBe(true);
    expect(checkout.intent).toBe('checkout');
  });

  it('валидирует LLM JSON и отклоняет смешение wifi access/problem', () => {
    const valid = validateTelegramSemanticRouterResult({
      intent: 'wifi_problem',
      confidence: 0.91,
      topic: 'wifi',
      is_problem: true,
      needs_booking_context: true,
      requested_secret: false,
      knowledge_keys: ['wifi_name'],
      slots: { problem_type: 'internet_not_working' },
      guest_safe_summary: 'Гость сообщает, что интернет не работает.',
    });
    expect(valid.ok).toBe(true);

    const invalid = validateTelegramSemanticRouterResult({
      intent: 'wifi_access',
      confidence: 0.9,
      topic: 'wifi',
      is_problem: true,
      needs_booking_context: false,
      requested_secret: false,
      knowledge_keys: [],
      slots: { problem_type: null },
      guest_safe_summary: 'Гость просит пароль Wi-Fi.',
    });
    expect(invalid).toMatchObject({ ok: false, reason: 'wifi_access_marked_problem' });
  });
});

describe('Telegram semantic router in autopilot', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('применяет deterministic semantic для проблемы Wi-Fi без LLM', () => {
    const semantic = mapSemanticRouterToAutopilotIntent(
      classifyTelegramGuestSemanticDeterministic('у нас пропал интернет, сайты не открываются'),
    );
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'у нас пропал интернет, сайты не открываются',
      semanticClassification: semantic,
    });

    expect(decision.metadata.intent).toBe('wifi_problem');
    expect(decision.action).toBe('needs_context');
    expect(decision.replyText ?? '').toMatch(/что именно происходит/i);
  });

  it('использует LLM semantic provider когда включён', async () => {
    vi.stubEnv('TELEGRAM_SEMANTIC_ROUTER_ENABLED', 'true');

    const provider: TelegramSemanticRouterProvider = {
      name: 'openai',
      modelName: 'test-model',
      classify: vi.fn().mockResolvedValue({
        intent: 'wifi_access',
        confidence: 0.93,
        topic: 'wifi',
        is_problem: false,
        needs_booking_context: true,
        requested_secret: true,
        knowledge_keys: ['wifi_password'],
        slots: { problem_type: null },
        guest_safe_summary: 'Гость просит пароль от Wi-Fi.',
        source: 'llm',
      }),
    };

    const route = await routeTelegramGuestSemantic(
      { messageText: 'подскажите пароль от сети гостя' },
      provider,
    );

    expect(route.ok).toBe(true);
    if (route.ok) {
      expect(route.result.intent).toBe('wifi_access');
      expect(route.provider).toBe('openai');
    }
  });

  it('откатывается на deterministic при конфликте LLM wifi access vs problem', async () => {
    vi.stubEnv('TELEGRAM_SEMANTIC_ROUTER_ENABLED', 'true');

    const provider: TelegramSemanticRouterProvider = {
      name: 'openai',
      classify: vi.fn().mockResolvedValue({
        intent: 'wifi_access',
        confidence: 0.95,
        topic: 'wifi',
        is_problem: false,
        needs_booking_context: false,
        requested_secret: false,
        knowledge_keys: [],
        slots: { problem_type: null },
        guest_safe_summary: 'Гость спрашивает про Wi-Fi.',
        source: 'llm',
      }),
    };

    const route = await routeTelegramGuestSemantic(
      { messageText: 'интернет не работает совсем' },
      provider,
    );

    expect(route.ok).toBe(false);
    if (!route.ok) {
      expect(route.fallback.intent).toBe('wifi_problem');
    }
  });
});
