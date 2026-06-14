import { supabase } from '@/lib/supabase';

export type TelegramRateLimitAction =
  | 'lead_start'
  | 'lead_complete'
  | 'support_message'
  | 'prompt_injection'
  | 'webhook_message';

export type TelegramRateLimitReason =
  | 'lead_start_hourly_limit'
  | 'lead_restart_hourly_limit'
  | 'support_hourly_limit'
  | 'repeated_prompt_injection'
  | 'prompt_injection_temporary_limit';

export type TelegramRateLimitEvent = {
  telegram_user_id: string;
  action_type: TelegramRateLimitAction;
  source?: string | null;
  created_at: string;
  metadata_json?: Record<string, unknown> | null;
};

export type TelegramRateLimitDecision = {
  rate_limited: boolean;
  rate_limit_reason: TelegramRateLimitReason | null;
  rate_limit_until: string | null;
  manual_review_recommended: boolean;
  manual_review_reason: 'rate_limited' | 'repeated_prompt_injection' | null;
  repeated_security_attempts_count: number;
};

export type CheckTelegramRateLimitInput = {
  telegramUserId: string;
  action: TelegramRateLimitAction;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  now?: Date;
};

const HOUR_MS = 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWENTY_MINUTES_MS = 20 * 60 * 1000;

const LEAD_START_LIMIT_PER_HOUR = 3;
const LEAD_RESTART_LIMIT_PER_HOUR = 10;
const SUPPORT_LIMIT_PER_HOUR = 5;
const PROMPT_INJECTION_MANUAL_REVIEW_COUNT = 3;
const PROMPT_INJECTION_TEMPORARY_LIMIT_COUNT = 5;

export const TELEGRAM_RATE_LIMITS = {
  leadStartPerHour: LEAD_START_LIMIT_PER_HOUR,
  leadRestartPerHour: LEAD_RESTART_LIMIT_PER_HOUR,
  supportPerHour: SUPPORT_LIMIT_PER_HOUR,
  promptInjectionManualReviewCount: PROMPT_INJECTION_MANUAL_REVIEW_COUNT,
  promptInjectionTemporaryLimitCount: PROMPT_INJECTION_TEMPORARY_LIMIT_COUNT,
  promptInjectionWindowMinutes: 30,
  temporaryLimitMinutes: 20,
} as const;

function emptyDecision(repeatedSecurityAttemptsCount = 0): TelegramRateLimitDecision {
  return {
    rate_limited: false,
    rate_limit_reason: null,
    rate_limit_until: null,
    manual_review_recommended: false,
    manual_review_reason: null,
    repeated_security_attempts_count: repeatedSecurityAttemptsCount,
  };
}

function createdTime(event: Pick<TelegramRateLimitEvent, 'created_at'>): number {
  const time = new Date(event.created_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function countRecent(
  history: readonly TelegramRateLimitEvent[],
  action: TelegramRateLimitAction,
  sinceMs: number,
  now: Date,
  metadataFilter?: (metadata: Record<string, unknown>) => boolean,
): number {
  const cutoff = now.getTime() - sinceMs;
  return history.filter((event) => {
    if (event.action_type !== action) return false;
    if (createdTime(event) < cutoff) return false;
    if (!metadataFilter) return true;
    const metadata = event.metadata_json && typeof event.metadata_json === 'object' ? event.metadata_json : {};
    return metadataFilter(metadata);
  }).length;
}

function temporaryLimitUntil(now: Date): string {
  return new Date(now.getTime() + TWENTY_MINUTES_MS).toISOString();
}

function limitedDecision(
  reason: TelegramRateLimitReason,
  now: Date,
  repeatedSecurityAttemptsCount: number,
  manualReason: TelegramRateLimitDecision['manual_review_reason'] = 'rate_limited',
): TelegramRateLimitDecision {
  return {
    rate_limited: true,
    rate_limit_reason: reason,
    rate_limit_until: temporaryLimitUntil(now),
    manual_review_recommended: true,
    manual_review_reason: manualReason,
    repeated_security_attempts_count: repeatedSecurityAttemptsCount,
  };
}

export function evaluateTelegramRateLimitFromHistory(input: {
  action: TelegramRateLimitAction;
  history: readonly TelegramRateLimitEvent[];
  now?: Date;
}): TelegramRateLimitDecision {
  const now = input.now ?? new Date();
  const promptInjectionCount = countRecent(input.history, 'prompt_injection', THIRTY_MINUTES_MS, now);

  if (promptInjectionCount >= PROMPT_INJECTION_TEMPORARY_LIMIT_COUNT) {
    return limitedDecision(
      'prompt_injection_temporary_limit',
      now,
      promptInjectionCount,
      'repeated_prompt_injection',
    );
  }

  if (input.action === 'webhook_message') {
    const startRestartCount = countRecent(
      input.history,
      'webhook_message',
      HOUR_MS,
      now,
      (metadata) => metadata.command === 'start',
    );
    if (startRestartCount > LEAD_RESTART_LIMIT_PER_HOUR) {
      return limitedDecision('lead_restart_hourly_limit', now, promptInjectionCount);
    }
  }

  if (input.action === 'lead_start') {
    const leadStartCount = countRecent(input.history, 'lead_start', HOUR_MS, now);
    if (leadStartCount > LEAD_START_LIMIT_PER_HOUR) {
      return limitedDecision('lead_start_hourly_limit', now, promptInjectionCount);
    }
  }

  if (input.action === 'support_message') {
    const supportCount = countRecent(input.history, 'support_message', HOUR_MS, now);
    if (supportCount > SUPPORT_LIMIT_PER_HOUR) {
      return limitedDecision('support_hourly_limit', now, promptInjectionCount);
    }
  }

  if (promptInjectionCount >= PROMPT_INJECTION_MANUAL_REVIEW_COUNT) {
    return {
      ...emptyDecision(promptInjectionCount),
      manual_review_recommended: true,
      manual_review_reason: 'repeated_prompt_injection',
      rate_limit_reason: 'repeated_prompt_injection',
    };
  }

  return emptyDecision(promptInjectionCount);
}

async function recordTelegramRateLimitEvent(input: CheckTelegramRateLimitInput, now: Date): Promise<void> {
  try {
    const { error } = await supabase
      .from('telegram_rate_limits')
      .insert({
        telegram_user_id: input.telegramUserId,
        action_type: input.action,
        source: input.source ?? null,
        created_at: now.toISOString(),
        metadata_json: input.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[tg:rate-limit] failed to record event', {
        telegram_user_id: input.telegramUserId,
        action: input.action,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn('[tg:rate-limit] failed to record event', {
      telegram_user_id: input.telegramUserId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadTelegramRateLimitHistory(telegramUserId: string, now: Date): Promise<TelegramRateLimitEvent[]> {
  try {
    const since = new Date(now.getTime() - HOUR_MS).toISOString();
    const { data, error } = await supabase
      .from('telegram_rate_limits')
      .select('telegram_user_id, action_type, source, created_at, metadata_json')
      .eq('telegram_user_id', telegramUserId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.warn('[tg:rate-limit] failed to load history', {
        telegram_user_id: telegramUserId,
        error: error.message,
      });
      return [];
    }

    return (data ?? []) as TelegramRateLimitEvent[];
  } catch (error) {
    console.warn('[tg:rate-limit] failed to load history', {
      telegram_user_id: telegramUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function checkTelegramRateLimit(input: CheckTelegramRateLimitInput): Promise<TelegramRateLimitDecision> {
  const now = input.now ?? new Date();
  await recordTelegramRateLimitEvent(input, now);
  const history = await loadTelegramRateLimitHistory(input.telegramUserId, now);
  return evaluateTelegramRateLimitFromHistory({ action: input.action, history, now });
}
