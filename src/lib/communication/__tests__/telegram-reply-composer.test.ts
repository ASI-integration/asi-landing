import { describe, it, expect } from 'vitest';
import {
  composeTelegramOperationalReply,
  composeTelegramOperationalMultiIntentReply,
} from '../telegram-reply-composer';
import {
  executeTelegramOperationalPolicy,
  executeTelegramOperationalPolicyMultiIntent,
} from '../telegram-operational-policy-executor';

const categories = [
  'access_issue',
  'late_checkout',
  'early_checkin',
  'no_heating',
  'noise_complaint',
  'cleaning_request',
  'extension_request',
  'wifi_issue',
  'parking_question',
  'payment_confirmation',
] as const;

describe('composeTelegramOperationalReply', () => {
  it('produces 2 deterministic variants per category (EN reply)', () => {
    for (const category of categories) {
      const a = composeTelegramOperationalReply({
        update_id: 1,
        category,
        action: 'reply',
        lang: 'en',
        text: 'test message',
        extractedFacts: {},
        missingFacts: [],
        urgency: 'normal',
        linkingState: null,
        sessionCase: null,
        sessionMemory: null,
      });
      const b = composeTelegramOperationalReply({
        update_id: 2,
        category,
        action: 'reply',
        lang: 'en',
        text: 'test message',
        extractedFacts: {},
        missingFacts: [],
        urgency: 'normal',
        linkingState: null,
        sessionCase: null,
        sessionMemory: null,
      });
      expect(a.template_key).not.toEqual(b.template_key);
      expect(a.text).toMatch(/Understood/i);
      expect(b.text).toMatch(/Understood/i);
      // No generic uncertainty for known operational categories
      expect(a.text).not.toMatch(/not entirely sure/i);
      expect(b.text).not.toMatch(/not entirely sure/i);
    }
  });

  it('produces 2 deterministic variants per category (RU reply)', () => {
    for (const category of categories) {
      const a = composeTelegramOperationalReply({
        update_id: 1,
        category,
        action: 'reply',
        lang: 'ru',
        text: 'тест',
        extractedFacts: {},
        missingFacts: [],
        urgency: 'normal',
        linkingState: null,
        sessionCase: null,
        sessionMemory: null,
      });
      const b = composeTelegramOperationalReply({
        update_id: 2,
        category,
        action: 'reply',
        lang: 'ru',
        text: 'тест',
        extractedFacts: {},
        missingFacts: [],
        urgency: 'normal',
        linkingState: null,
        sessionCase: null,
        sessionMemory: null,
      });
      expect(a.template_key).not.toEqual(b.template_key);
      expect(a.text).toMatch(/Понял/i);
      expect(b.text).toMatch(/Понял/i);
      // No English generic fallback phrases
      expect(a.text).not.toMatch(/not entirely sure/i);
      expect(b.text).not.toMatch(/not entirely sure/i);
    }
  });

  it('clarify asks exactly one question (EN + RU)', () => {
    const en = composeTelegramOperationalReply({
      update_id: 10,
      category: 'access_issue',
      action: 'clarify',
      lang: 'en',
      text: 'cannot open door',
      extractedFacts: {},
      missingFacts: ['property', 'failure_mode'],
      urgency: 'normal',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    expect((en.text.match(/\?/g) ?? []).length).toBe(1);
    expect(en.text).toMatch(/Understood/i);

    const ru = composeTelegramOperationalReply({
      update_id: 11,
      category: 'late_checkout',
      action: 'clarify',
      lang: 'ru',
      text: 'поздний выезд',
      extractedFacts: {},
      missingFacts: ['property'],
      urgency: 'normal',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    expect((ru.text.match(/\?/g) ?? []).length).toBe(1);
    expect(ru.text).toMatch(/Понял/i);
  });

  it('escalations are explicit and distinguish urgent vs normal', () => {
    const normal = composeTelegramOperationalReply({
      update_id: 20,
      category: 'wifi_issue',
      action: 'escalate_operator',
      lang: 'en',
      text: 'internet down',
      extractedFacts: {},
      missingFacts: [],
      urgency: 'normal',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    expect(normal.text).toMatch(/passing.*team/i);
    expect(normal.text).not.toMatch(/urgent/i);

    const urgent = composeTelegramOperationalReply({
      update_id: 21,
      category: 'no_heating',
      action: 'escalate_urgent',
      lang: 'en',
      text: 'no heating urgent',
      extractedFacts: {},
      missingFacts: [],
      urgency: 'urgent',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    expect(urgent.text).toMatch(/urgent/i);
    expect(urgent.text).toMatch(/escalat/i);
  });

  it('Spanish surface replies when text is clearly Spanish', () => {
    const es = composeTelegramOperationalReply({
      update_id: 30,
      category: 'parking_question',
      action: 'clarify',
      lang: 'en',
      text: 'Hola, ¿hablas español? Necesito parking.',
      extractedFacts: {},
      missingFacts: ['property'],
      urgency: 'normal',
      linkingState: null,
      sessionCase: null,
      sessionMemory: null,
    });
    expect(es.language).toBe('es');
    expect(es.text).toMatch(/Entendido|¿/);
  });

  it('builds Russian reply from policy result without placeholders', () => {
    const policy = executeTelegramOperationalPolicy({
      messageText: 'Здравствуйте, я гость. Хочу заехать завтра в 15:00',
      update_id: 77,
    });
    const out = composeTelegramOperationalReply({
      update_id: 77,
      category: 'checkin_time_question',
      action: 'clarify',
      lang: 'ru',
      text: 'Здравствуйте, я гость. Хочу заехать завтра в 15:00',
      extractedFacts: {},
      missingFacts: ['property'],
      urgency: 'normal',
      policyResult: policy,
    });
    expect(out.text).toMatch(/15:00 обычно.*стандартн/i);
    expect(out.text).toMatch(/объекта или брони/i);
    expect(out.text).not.toMatch(/Понял\(а\)/);
  });

  it('builds structured RU reply for 8+ intents and groups escalations at the end', () => {
    const multi = executeTelegramOperationalPolicyMultiIntent({
      update_id: 2026,
      knownContext: { objectLabel: 'Невский 24', bookingReference: 'BK-88' },
      messageText:
        'По брони BK-88: можно заезд в 15:00 и в 07:00, поздний выезд до 13:00, не открывается дверь, где wi-fi, можно с котом, парковка есть, какие документы нужны, и что по отмене и возврату?',
    });
    const out = composeTelegramOperationalMultiIntentReply({ intents: multi.intents, lang: 'ru' });
    expect(out.text).toMatch(/По пунктам:/);
    expect(out.text).toMatch(/1\./);
    expect(out.text).toMatch(/2\./);
    expect(out.text).toMatch(/3\./);
    expect(out.text).toMatch(/требуют проверки объекта\/брони/i);
    expect(out.text).toMatch(/передам оператору/i);
    expect(out.text).not.toMatch(/передаю команде/i);
  });

  it('omits slow_ack from finalized multi-intent reply and keeps numbered newline format', () => {
    const out = composeTelegramOperationalMultiIntentReply({
      lang: 'ru',
      intents: [
        {
          action: 'slow_ack',
          scenarioFamily: 'SLOW_ACK',
          confidence: 0.61,
          requiredContext: [],
          safeReplyFacts: [],
          forbiddenClaims: [],
          nextSessionMemory: {},
        },
        {
          action: 'auto_reply',
          scenarioFamily: 'WIFI',
          confidence: 0.9,
          requiredContext: [],
          safeReplyFacts: [],
          forbiddenClaims: [],
          nextSessionMemory: {},
        },
        {
          action: 'auto_reply',
          scenarioFamily: 'PARKING',
          confidence: 0.9,
          requiredContext: [],
          safeReplyFacts: [],
          forbiddenClaims: [],
          nextSessionMemory: {},
        },
      ],
    });

    expect(out.text).toMatch(/^По пунктам:\n1\.\s.+\n2\.\s.+\n$/);
    expect(out.text).not.toMatch(/разбираюсь с запросом|вернусь с ответом через пару секунд|slow[_\s-]?ack/i);
  });
});

