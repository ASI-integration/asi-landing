import { describe, expect, it, vi } from 'vitest';

import { decideGuestCommunicationWithLlmSafeDomainLayer } from '../guest-communication-brain';
import {
  buildOutOfDomainRedirectReply,
  classifyLlmSafeDomainZoneLocally,
  runLlmSafeDomainLayer,
  type LlmSafeDomainProvider,
} from '../llm-safe-domain-layer';
import { shouldPreferCommunicationAutopilotV1 } from '../communication-autopilot-v1-orchestrator';

function conversationalProvider(spy?: (messageText: string) => void): LlmSafeDomainProvider {
  return {
    name: 'openai',
    modelName: 'gpt-mini-test',
    async classifySafeDomain(input) {
      spy?.(input.messageText);
      return {
        intent: 'guest_social_conversation',
        domainZone: 'adjacent',
        safeToAnswer: true,
        suggestedReply:
          'После дороги это понятно. Отдохните немного — если потом понадобится что-то по поездке или квартире, я рядом.',
        escalationRequired: false,
        reason: 'safe_social_conversation',
        confidence: 0.92,
      };
    },
  };
}

const SOCIAL_TURNS = [
  'Привет',
  'Добрый вечер',
  'Спасибо большое',
  'Я сегодня впервые в Питере.',
  'Я ужасно устал после самолёта.',
  'Наконец-то добрался.',
  'Ну и денёк.',
  'Дорога была сумасшедшая.',
  'Кажется, я сейчас просто упаду спать.',
  'Тут очень красиво.',
  'Мне нравится этот город.',
  'Я немного волнуюсь, я тут впервые.',
  'После самолёта вообще не соображаю.',
  'Мы наконец приехали.',
  'Всё хорошо, просто устал.',
  'Пока просто осматриваюсь.',
  'Хорошо, спасибо.',
  'Понял, благодарю.',
  'Звучит отлично.',
  'Кажется, кофе сейчас спасёт меня.',
  'Я, наверное, немного посплю.',
  'Давно хотел побывать здесь.',
  'Первый день всегда самый суматошный.',
  'Просто хотел сказать спасибо.',
  'Наконец можно выдохнуть.',
  'Мы приехали с детьми, все вымотались.',
  'Сегодня всё как-то наперекосяк.',
  'Надеюсь, завтра будет спокойнее.',
  'Какой длинный был день.',
  'Я путешествую один.',
] as const;

const SENSITIVE_TURNS = [
  'Верните мне деньги за бронирование.',
  'Я хочу отменить бронь.',
  'Дайте мне скидку.',
  'Замок сломан, я не могу попасть внутрь.',
  'В квартире пахнет газом.',
  'У нас дым и кажется пожар.',
  'Я хочу подать жалобу на сервис.',
  'У меня конфликт с владельцем.',
  'Куда отправить данные банковской карты?',
  'Можно мне поздний выезд до 18:00?',
] as const;

const DETERMINISTIC_OPERATIONAL_TURNS = [
  'Во сколько выезд?',
  'Во сколько заезд?',
  'Какой пароль от Wi-Fi?',
  'До которого часа можно шуметь?',
  'Какой адрес квартиры?',
  'Где парковка?',
  'Замок сломан и не открывается.',
  'Хочу возврат денег.',
] as const;

describe('Conversational Concierge v1 dialogue pack', () => {
  for (const messageText of SOCIAL_TURNS) {
    it(`answers harmless social turn naturally: ${messageText}`, async () => {
      const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
        messageText,
        currentIdentity: 'guest',
        conversationMemory: {},
        llmSafeDomainProvider: conversationalProvider(),
      });

      expect(decision.responseMode).toBe('answer_from_concierge');
      expect(decision.shouldEscalate).toBe(false);
      expect(decision.outcome).toBe('answered_by_concierge_autopilot');
      expect(decision.llmSafeDomain?.domainZone).toBe('adjacent');
      expect(decision.safeGuestReply).not.toMatch(/номер\s+брон|номер\s+брони|объект|уточните/i);
    });
  }

  it('classifies the first-time-in-city exhausted-traveler example as adjacent conversation', () => {
    expect(
      classifyLlmSafeDomainZoneLocally(
        'Я вообще сегодня в Питере первый раз, ужасно устал после самолёта.',
      ),
    ).toEqual({ domainZone: 'adjacent', reason: 'local_adjacent_conversation' });
  });

  it('passes a short sanitized dialogue context into MiniGPT for continuity', async () => {
    let seenContext: string | null | undefined;
    const provider: LlmSafeDomainProvider = {
      name: 'openai',
      modelName: 'gpt-mini-test',
      async classifySafeDomain(input) {
        seenContext = input.conversationContext;
        return {
          intent: 'guest_social_conversation',
          domainZone: 'adjacent',
          safeToAnswer: true,
          suggestedReply: 'Да, после тяжёлого перелёта лучше сначала немного отдохнуть.',
          escalationRequired: false,
          reason: 'conversation_continuity',
          confidence: 0.93,
        };
      },
    };

    const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
      messageText: 'Да, перелёт был тяжёлый. Наверное, сначала немного отдохну.',
      currentIdentity: 'guest',
      conversationMemory: {},
      conversationContext:
        'guest: Я вообще сегодня в Питере первый раз, ужасно устал после самолёта.\nassistant: После дороги это понятно. Немного отдохните.',
      llmSafeDomainProvider: provider,
    });

    expect(seenContext).toMatch(/Питере первый раз/);
    expect(seenContext).toMatch(/После дороги/);
    expect(decision.responseMode).toBe('answer_from_concierge');
    expect(decision.safeGuestReply).toMatch(/отдохнуть/);
  });

  it('uses a soft boundary for a substantive out-of-domain model decision instead of asking to repeat', async () => {
    const provider: LlmSafeDomainProvider = {
      name: 'openai',
      modelName: 'gpt-mini-test',
      async classifySafeDomain() {
        return {
          intent: 'politics',
          domainZone: 'out_of_domain',
          safeToAnswer: false,
          suggestedReply: '',
          escalationRequired: false,
          reason: 'substantive_unrelated_topic',
          confidence: 0.91,
        };
      },
    };

    const result = await runLlmSafeDomainLayer({
      messageText: 'Расскажи подробно про случайную тему, никак не связанную с поездкой.',
      detectedIntent: 'unclear_role',
      responseMode: 'ask_clarifying_question',
      provider,
    });

    expect(result.applied).toBe(true);
    if (!result.applied) throw new Error('expected soft redirect');
    expect(result.validation).toBe('local_redirect');
    expect(result.decision.domainZone).toBe('out_of_domain');
    expect(result.decision.suggestedReply).toBe(buildOutOfDomainRedirectReply());
    expect(result.decision.suggestedReply).not.toMatch(/повторите|номер брони|номер бронирования/i);
  });

  for (const messageText of SENSITIVE_TURNS) {
    it(`keeps sensitive turn off the conversational provider: ${messageText}`, async () => {
      const called = vi.fn();
      const decision = await decideGuestCommunicationWithLlmSafeDomainLayer({
        messageText,
        currentIdentity: 'guest',
        conversationMemory: {},
        llmSafeDomainProvider: conversationalProvider(() => called()),
      });

      expect(called).not.toHaveBeenCalled();
      expect(decision.shouldEscalate).toBe(true);
      expect(decision.responseMode).toBe('operator_escalation');
    });
  }

  for (const messageText of DETERMINISTIC_OPERATIONAL_TURNS) {
    it(`keeps deterministic V1 first for operational/sensitive turn: ${messageText}`, () => {
      expect(shouldPreferCommunicationAutopilotV1(messageText)).toBe(true);
    });
  }

  for (const messageText of [
    'Я ужасно устал после самолёта.',
    'Наконец-то добрались, ну и денёк.',
    'Тут очень красиво.',
    'Я впервые в Питере.',
    'Спасибо, я немного отдохну.',
  ]) {
    it(`lets harmless social turn fall through deterministic V1: ${messageText}`, () => {
      expect(shouldPreferCommunicationAutopilotV1(messageText)).toBe(false);
    });
  }
});
