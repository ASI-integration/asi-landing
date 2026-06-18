import type { TelegramUpdate } from './types';

export const TELEGRAM_TECHNICAL_ERROR_REPLY =
  'Есть техническая ошибка, команда ASI уже видит проблему';

export type TelegramWebhookScope = 'operational' | 'asi_feedback' | 'unscoped';

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function feedbackAndOperationalShareBot(): boolean {
  const operational = readOptionalEnv('TELEGRAM_BOT_TOKEN');
  const feedback = readOptionalEnv('ASI_FEEDBACK_BOT_TOKEN');
  return Boolean(operational && feedback && operational === feedback);
}

/** Updates that belong to ASI Feedback routing (role selection, guest_test, support). */
export function isAsiFeedbackRoutingUpdate(update: TelegramUpdate | null | undefined): boolean {
  if (!update) return false;
  const message = update.message ?? update.edited_message ?? update.callback_query?.message ?? null;
  const text = (message?.text ?? message?.caption ?? '').trim();
  if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  if (/^\/guest_test(?:@\w+)?/i.test(text)) return true;
  if (/^\/support(?:@\w+)?/i.test(text)) return true;
  if (/^\/reset_test_state(?:@\w+)?/i.test(text)) return true;
  if (/^\/emergency_test(?:@\w+)?/i.test(text)) return true;
  const callbackData = String(update.callback_query?.data ?? '');
  if (callbackData.startsWith('tr:')) return true;
  return false;
}

export function shouldTryLeadIntake(scope: TelegramWebhookScope): boolean {
  if (scope === 'asi_feedback') return true;
  if (scope === 'unscoped' && !readOptionalEnv('ASI_FEEDBACK_WEBHOOK_SECRET')) return true;
  if (scope === 'operational' && feedbackAndOperationalShareBot()) return true;
  return false;
}

/**
 * ASI Feedback bot may still be registered with the operational webhook secret.
 * Route only feedback-shaped updates so operational guest traffic stays on orchestrator.
 */
export function shouldTryAsiFeedbackRouting(
  scope: TelegramWebhookScope,
  update: TelegramUpdate | null | undefined,
): boolean {
  if (shouldTryLeadIntake(scope)) return true;
  if (scope !== 'operational') return false;
  if (!readOptionalEnv('ASI_FEEDBACK_BOT_TOKEN')) return false;
  return isAsiFeedbackRoutingUpdate(update);
}

export function resolveWebhookScope(secretGot: string | null): TelegramWebhookScope | null {
  const operationalSecret = readOptionalEnv('TELEGRAM_WEBHOOK_SECRET');
  const feedbackSecret = readOptionalEnv('ASI_FEEDBACK_WEBHOOK_SECRET');
  const hasAnySecret = Boolean(operationalSecret || feedbackSecret);

  if (!hasAnySecret) return 'unscoped';
  if (feedbackSecret && secretGot === feedbackSecret) return 'asi_feedback';
  if (operationalSecret && secretGot === operationalSecret) return 'operational';
  return null;
}
