import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

import {
  buildCanonicalRuCheckinTimeReply,
  classifyCanonicalCheckinTime,
  getCommunicationCanonRuleGroups,
  getTelegramCommunicationCanon,
} from '../telegram-communication-canon';
import {
  executeTelegramOperationalPolicy,
  executeTelegramOperationalPolicyMultiIntent,
} from '../telegram-operational-policy-executor';
import { composeTelegramOperationalMultiIntentReply } from '../telegram-reply-composer';
import { POST } from '@/app/api/internal/telegram-dry-run/route';

describe('Telegram communication canon compliance', () => {
  beforeEach(() => {
    mockProcessMessage.mockReset();
    mockProcessMessage.mockResolvedValue({
      outcome: 'replied',
      reply: 'canonical dry-run reply',
    });
    process.env.INTERNAL_TEST_SECRET = 'canon-secret';
  });

  it('exports canon docs and expected rule groups', () => {
    const canon = getTelegramCommunicationCanon();
    const groups = getCommunicationCanonRuleGroups();

    expect(canon.sources.map((source) => source.path)).toEqual(
      expect.arrayContaining([
        'docs/CANONICAL-AI-GUIDED-SETUP-AND-DASHBOARD.md',
        'docs/telegram-bot-source-of-truth.md',
        'docs/telegram-communication-architecture.md',
        'docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md',
      ]),
    );
    expect(groups.requiredContext.objectOrBooking).toEqual(
      expect.arrayContaining(['WIFI', 'ADDRESS_FIND_OBJECT', 'PARKING', 'ACCESS_KEY_ISSUE']),
    );
    expect(groups.requiresEscalation).toEqual(expect.arrayContaining(['CANCELLATION_REFUND', 'COMPLAINTS_PROBLEMS']));
    expect(groups.toneStyle.russianGuestReplies).toContain('no_gender_placeholders');
    expect(groups.prohibitedHallucinations).toContain('do_not_invent_object_specific_facts');
  });

  it('treats 06:00-08:00 check-in as very early without same-day cleaning certainty', () => {
    const policy = classifyCanonicalCheckinTime('07:00');
    const reply = buildCanonicalRuCheckinTimeReply({
      bucket: policy.bucket,
      time: '07:00',
      hasProperty: true,
    });

    expect(policy.bucket).toBe('very_early_checkin');
    expect(policy.requiresCleaningAvailability).toBe(false);
    expect(reply).toMatch(/свободен с предыдущей ночи/i);
    expect(reply).not.toMatch(/уборк/i);
  });

  it('treats 15:00 as standard check-in', () => {
    const policy = classifyCanonicalCheckinTime('15:00');
    const result = executeTelegramOperationalPolicy({
      messageText: 'Можно заехать в 15:00?',
      knownContext: { objectLabel: 'Невский 24' },
    });

    expect(policy.scenarioFamily).toBe('CHECK_IN_STANDARD');
    expect(result.scenarioFamily).toBe('CHECK_IN_STANDARD');
    expect(result.action).toBe('auto_reply');
  });

  it('treats 12:00 as conditional rather than guaranteed', () => {
    const policy = classifyCanonicalCheckinTime('12:00');
    const reply = buildCanonicalRuCheckinTimeReply({
      bucket: policy.bucket,
      time: '12:00',
      hasProperty: true,
    });

    expect(policy.bucket).toBe('conditional_early_checkin');
    expect(policy.requiresCleaningAvailability).toBe(true);
    expect(reply).toMatch(/условным подтверждением|зависит/i);
    expect(reply).not.toMatch(/гарант/i);
  });

  it('composes one final multi-intent reply and omits slow_ack text', () => {
    const multi = executeTelegramOperationalPolicyMultiIntent({
      update_id: 2400,
      knownContext: { objectLabel: 'Невский 24', bookingReference: 'BK-24' },
      messageText:
        'Можно заезд в 15:00 и в 12:00, где Wi-Fi, есть парковка и как отменить бронь с возвратом?',
    });
    const out = composeTelegramOperationalMultiIntentReply({ intents: multi.intents, lang: 'ru' });

    expect(out.text.match(/По пунктам:/g)?.length).toBe(1);
    expect(out.text).toMatch(/1\./);
    expect(out.text).toMatch(/передам оператору/i);
    expect(out.text).not.toMatch(/slow[_\s-]?ack|через пару секунд|разбираюсь с запросом/i);
  });

  it('requires object or booking context for Wi-Fi, key, address, and parking facts', () => {
    const cases = [
      ['wifi', 'Где пароль от Wi-Fi?'],
      ['key', 'Код двери не работает'],
      ['address', 'Как найти вход?'],
      ['parking', 'Где парковка?'],
    ] as const;

    for (const [, messageText] of cases) {
      const result = executeTelegramOperationalPolicy({ messageText });
      expect(result.action).toBe('clarify');
      expect(result.requiredContext.join('|')).toMatch(/property|reservation|booking|object/i);
    }
  });

  it('marks urgent access for operator action', () => {
    const result = executeTelegramOperationalPolicyMultiIntent({
      messageText: 'Срочно, не могу войти прямо сейчас, код двери не работает',
      update_id: 2401,
    });

    expect(result.intents.some((intent) => intent.scenarioFamily === 'ACCESS_KEY_ISSUE' && intent.action === 'escalate')).toBe(true);
  });

  it('escalates complaints, refunds, and cancellations through canonical policy', () => {
    const complaint = executeTelegramOperationalPolicy({
      messageText: 'Жалоба: в квартире проблема, всё сломано',
      knownContext: { objectLabel: 'Невский 24' },
    });
    const refund = executeTelegramOperationalPolicy({
      messageText: 'Хочу отмену брони и refund',
      knownContext: { bookingReference: 'BK-24' },
    });

    expect(complaint.scenarioFamily).toBe('COMPLAINTS_PROBLEMS');
    expect(complaint.action).toBe('escalate');
    expect(refund.scenarioFamily).toBe('CANCELLATION_REFUND');
    expect(refund.action).toBe('escalate');
  });

  it('asks clarification for unknown object instead of guessing facts', () => {
    const result = executeTelegramOperationalPolicy({ messageText: 'Где Wi-Fi и парковка?' });

    expect(result.action).toBe('clarify');
    expect(result.forbiddenClaims).toEqual(expect.arrayContaining(['do_not_disclose_password_not_bound_to_verified_property']));
  });

  it('dry-run endpoint returns operational decision fields', async () => {
    const req = new Request('https://example.test/api/internal/telegram-dry-run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'canon-secret',
      },
      body: JSON.stringify({
        text: 'Можно заезд в 15:00 и где Wi-Fi?',
        chatId: 'canon-chat',
        objectName: 'Невский 24',
        bookingId: 'BK-24',
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        detectedIntents: expect.any(Array),
        replyText: 'canonical dry-run reply',
        actions: expect.any(Array),
        escalated: expect.any(Boolean),
        slowAckSent: false,
        finalReplied: true,
      }),
    );
    expect(body.detectedIntents).toContain('check_in_standard');
    expect(body.actions).toContain('reply');
  });
});
