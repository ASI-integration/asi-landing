/** Property-level and global defaults for Telegram Voice Response Policy v1. */

export type PropertyVoicePolicySettings = {
  voiceRepliesEnabled: boolean;
  voiceForUrgent: boolean;
  voiceForNightCoreIssues: boolean;
  voiceForAllInboundVoice: boolean;
  nightStart: string;
  nightEnd: string;
  timezone: string;
  dailyVoiceReplyLimitPerChat: number;
  maxVoiceReplySeconds: number;
  maxVoiceTextChars: number;
};

export const DEFAULT_PROPERTY_VOICE_POLICY: PropertyVoicePolicySettings = {
  voiceRepliesEnabled: true,
  voiceForUrgent: true,
  voiceForNightCoreIssues: true,
  voiceForAllInboundVoice: false,
  nightStart: '22:00',
  nightEnd: '08:00',
  timezone: 'Europe/Moscow',
  dailyVoiceReplyLimitPerChat: 30,
  maxVoiceReplySeconds: 45,
  maxVoiceTextChars: 700,
};

export const VOICE_FIRST_NOTICE_RU =
  'Голосовые ответы включаются для срочных вопросов и ночных ситуаций по проживанию. Если удобнее только текстом, напишите /voice_off.';

export const VOICE_SAFE_MONEY_HANDOFF_RU =
  'Понял вопрос. Здесь нужна проверка оператора, чтобы не дать неверную информацию. Я передам обращение и вернусь с ответом здесь.';

export const VOICE_SAFE_URGENT_HANDOFF_RU =
  'Понял, это срочная ситуация. Я передам обращение оператору. Оставайтесь на связи, ответ придёт здесь.';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const m = String(value ?? '').trim().match(TIME_RE);
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

export function resolvePropertyVoicePolicy(
  overrides?: Partial<PropertyVoicePolicySettings> | null,
): PropertyVoicePolicySettings {
  const envDaily = Number(process.env.VOICE_DAILY_REPLY_LIMIT_PER_CHAT ?? '');
  const envMaxSecs = Number(process.env.VOICE_MAX_REPLY_SECONDS ?? '');
  const envMaxChars = Number(process.env.VOICE_MAX_TEXT_CHARS ?? process.env.VOICE_REPLY_MAX_CHARS ?? '');

  return {
    ...DEFAULT_PROPERTY_VOICE_POLICY,
    ...(overrides ?? {}),
    dailyVoiceReplyLimitPerChat:
      Number.isFinite(envDaily) && envDaily > 0
        ? envDaily
        : (overrides?.dailyVoiceReplyLimitPerChat ?? DEFAULT_PROPERTY_VOICE_POLICY.dailyVoiceReplyLimitPerChat),
    maxVoiceReplySeconds:
      Number.isFinite(envMaxSecs) && envMaxSecs > 0
        ? envMaxSecs
        : (overrides?.maxVoiceReplySeconds ?? DEFAULT_PROPERTY_VOICE_POLICY.maxVoiceReplySeconds),
    maxVoiceTextChars:
      Number.isFinite(envMaxChars) && envMaxChars > 0
        ? envMaxChars
        : (overrides?.maxVoiceTextChars ?? DEFAULT_PROPERTY_VOICE_POLICY.maxVoiceTextChars),
  };
}

export type ChatVoiceUserSettings = {
  voiceRepliesEnabled: boolean;
  voiceNoticeSent: boolean;
};

export function loadChatVoiceUserSettings(collectedData?: Record<string, string | undefined>): ChatVoiceUserSettings {
  const raw = String(collectedData?.voice_replies_enabled ?? '').trim().toLowerCase();
  return {
    voiceRepliesEnabled: raw !== 'false' && raw !== '0' && raw !== 'off',
    voiceNoticeSent: collectedData?.voice_notice_sent === 'true',
  };
}
