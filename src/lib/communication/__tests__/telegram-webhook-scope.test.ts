import { describe, expect, it } from 'vitest';
import { tgTextUpdate } from '@/lib/communication/dev/telegram-fixtures';
import {
  feedbackAndOperationalShareBot,
  isAsiFeedbackRoutingUpdate,
  resolveWebhookScope,
  shouldTryAsiFeedbackRouting,
  shouldTryLeadIntake,
} from '@/lib/communication/telegram-webhook-scope';

describe('telegram-webhook-scope', () => {
  it('resolves feedback and operational secrets independently', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'operational-secret';
    process.env.ASI_FEEDBACK_WEBHOOK_SECRET = 'feedback-secret';

    expect(resolveWebhookScope('feedback-secret')).toBe('asi_feedback');
    expect(resolveWebhookScope('operational-secret')).toBe('operational');
    expect(resolveWebhookScope('wrong')).toBeNull();
  });

  it('detects ASI Feedback routing updates', () => {
    expect(isAsiFeedbackRoutingUpdate(tgTextUpdate({ chat_id: 1, text: '/start', update_id: 1 }))).toBe(true);
    expect(isAsiFeedbackRoutingUpdate(tgTextUpdate({ chat_id: 1, text: '/start guest_test_prop-1', update_id: 2 }))).toBe(true);
    expect(isAsiFeedbackRoutingUpdate(tgTextUpdate({ chat_id: 1, text: 'какой Wi-Fi?', update_id: 3 }))).toBe(false);
  });

  it('routes feedback-shaped /start on operational scope when feedback bot token is configured', () => {
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'feedback-token';
    process.env.TELEGRAM_BOT_TOKEN = 'operational-token';
    process.env.ASI_FEEDBACK_WEBHOOK_SECRET = 'feedback-secret';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'operational-secret';

    expect(shouldTryLeadIntake('operational')).toBe(false);
    expect(
      shouldTryAsiFeedbackRouting(
        'operational',
        tgTextUpdate({ chat_id: 10, text: '/start', update_id: 10 }),
      ),
    ).toBe(true);
    expect(
      shouldTryAsiFeedbackRouting(
        'operational',
        tgTextUpdate({ chat_id: 11, text: 'какой адрес?', update_id: 11 }),
      ),
    ).toBe(false);
  });

  it('treats shared bot token as feedback pipeline on operational scope', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'same-token';
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'same-token';
    expect(feedbackAndOperationalShareBot()).toBe(true);
    expect(shouldTryLeadIntake('operational')).toBe(true);
  });
});
