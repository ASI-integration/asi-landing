import { describe, expect, it } from 'vitest';
import {
  evaluateTelegramRateLimitFromHistory,
  type TelegramRateLimitEvent,
} from '../telegram-rate-limit';

const now = new Date('2026-06-14T10:00:00.000Z');

function event(
  action_type: TelegramRateLimitEvent['action_type'],
  minutesAgo: number,
  metadata_json: Record<string, unknown> = {},
): TelegramRateLimitEvent {
  return {
    telegram_user_id: '9001',
    action_type,
    source: 'site',
    created_at: new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString(),
    metadata_json,
  };
}

describe('telegram rate limit v1', () => {
  it('soft-limits the fourth new lead start within one hour', () => {
    const decision = evaluateTelegramRateLimitFromHistory({
      action: 'lead_start',
      now,
      history: [
        event('lead_start', 0),
        event('lead_start', 10),
        event('lead_start', 20),
        event('lead_start', 30),
      ],
    });

    expect(decision).toMatchObject({
      rate_limited: true,
      rate_limit_reason: 'lead_start_hourly_limit',
      manual_review_recommended: true,
      manual_review_reason: 'rate_limited',
    });
  });

  it('moves repeated prompt injection to manual review, then temporary soft limit', () => {
    const manual = evaluateTelegramRateLimitFromHistory({
      action: 'prompt_injection',
      now,
      history: [
        event('prompt_injection', 1),
        event('prompt_injection', 2),
        event('prompt_injection', 3),
      ],
    });
    const limited = evaluateTelegramRateLimitFromHistory({
      action: 'support_message',
      now,
      history: [
        event('prompt_injection', 1),
        event('prompt_injection', 2),
        event('prompt_injection', 3),
        event('prompt_injection', 4),
        event('prompt_injection', 5),
      ],
    });

    expect(manual).toMatchObject({
      rate_limited: false,
      manual_review_recommended: true,
      manual_review_reason: 'repeated_prompt_injection',
      repeated_security_attempts_count: 3,
    });
    expect(limited).toMatchObject({
      rate_limited: true,
      rate_limit_reason: 'prompt_injection_temporary_limit',
      manual_review_reason: 'repeated_prompt_injection',
      repeated_security_attempts_count: 5,
    });
    expect(limited.rate_limit_until).toBe('2026-06-14T10:20:00.000Z');
  });

  it('soft-limits the sixth support message within one hour', () => {
    const decision = evaluateTelegramRateLimitFromHistory({
      action: 'support_message',
      now,
      history: [
        event('support_message', 0),
        event('support_message', 5),
        event('support_message', 10),
        event('support_message', 15),
        event('support_message', 20),
        event('support_message', 25),
      ],
    });

    expect(decision).toMatchObject({
      rate_limited: true,
      rate_limit_reason: 'support_hourly_limit',
      manual_review_recommended: true,
    });
  });
});
