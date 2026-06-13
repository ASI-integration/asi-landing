export type AsiFeedbackLeadSource =
  | 'site'
  | 'tenchat'
  | 'dzen'
  | 'telegram_group'
  | 'partner'
  | 'unknown';

export const ASI_FEEDBACK_LEAD_SOURCES: readonly AsiFeedbackLeadSource[] = [
  'site',
  'tenchat',
  'dzen',
  'telegram_group',
  'partner',
  'unknown',
] as const;

const DEFAULT_ASI_FEEDBACK_BOT_USERNAME = 'ASI_Global_Bot';

export function getAsiFeedbackBotUsername(): string {
  const configured = process.env.NEXT_PUBLIC_ASI_FEEDBACK_BOT_USERNAME?.trim();
  return (configured || DEFAULT_ASI_FEEDBACK_BOT_USERNAME).replace(/^@+/, '');
}

export function normalizeAsiFeedbackLeadSource(value: unknown): AsiFeedbackLeadSource {
  const source = String(value ?? '').trim().toLowerCase();
  return ASI_FEEDBACK_LEAD_SOURCES.includes(source as AsiFeedbackLeadSource)
    ? (source as AsiFeedbackLeadSource)
    : 'unknown';
}

export function buildAsiFeedbackTelegramLink(source: AsiFeedbackLeadSource = 'site'): string {
  const username = getAsiFeedbackBotUsername();
  return `https://t.me/${username}?start=${encodeURIComponent(source)}`;
}

export function getAsiFeedbackBotHandle(): string {
  return `@${getAsiFeedbackBotUsername()}`;
}
