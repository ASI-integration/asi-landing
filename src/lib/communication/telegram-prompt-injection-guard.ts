import * as fs from 'fs';
import * as path from 'path';

const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

export const TELEGRAM_PROMPT_INJECTION_FIRST_REPLY =
  'Я могу помочь только с вопросами по бронированию, заселению и проживанию. Напишите, пожалуйста, что нужно по вашему объекту или брони.';

export const TELEGRAM_PROMPT_INJECTION_BLOCKED_REPLY =
  'Сейчас могу отвечать только на вопросы по брони, заселению и проживанию.';

export type TelegramPromptInjectionGuardResult =
  | { action: 'allow' }
  | { action: 'block_first'; reason: string; blockedUntil: string }
  | { action: 'block_active'; blockedUntil: string }
  | { action: 'block_repeat'; reason: string; blockedUntil: string; violationCount: number };

type GuardRecord = {
  chatId: string;
  blockedUntil: string;
  violationCount: number;
  updatedAt: string;
};

type GuardStore = Record<string, GuardRecord>;

const isTest = process.env.NODE_ENV === 'test';
const stateDir =
  process.env.COMM_STATE_DIR ??
  process.env.CONVERSATION_SESSION_DIR ??
  process.env.SESSION_STORE_DIR ??
  process.env.STATE_DIR ??
  path.join(process.cwd(), '.asi-comm-state');
const statePath = path.join(stateDir, 'asi-telegram-prompt-injection-guard.json');

let loaded = false;
let store: GuardStore = {};

const INJECTION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'ignore_previous_instructions', pattern: /\b(ignore|forget|disregard|override)\b.{0,36}\b(previous|prior|all|system|developer)\b.{0,24}\b(instructions?|rules?|prompt)\b/i },
  { reason: 'ignore_rules', pattern: /\b(ignore|forget|disregard|override)\b.{0,30}\b(rules?|policy|policies|safety|guardrails?)\b/i },
  { reason: 'ru_forget_instructions', pattern: /(?:^|[^\p{L}\p{N}_])(забудь|игнорируй|отмени|обойди|перепиши).{0,40}(прошлые|предыдущие|все|системные).{0,30}(инструкции|правила|указания|промпт)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'ru_bypass_rules', pattern: /(?:^|[^\p{L}\p{N}_])(обойди|обойти|нарушь|сломай|сними).{0,36}(правила|ограничения|защиту|фильтр|политику)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'role_override', pattern: /\b(you are now|act as|pretend to be|become)\b.{0,36}\b(admin|administrator|developer|system|root|operator)\b/i },
  { reason: 'ru_role_override', pattern: /(?:^|[^\p{L}\p{N}_])(ты|вы)\s+теперь.{0,36}(админ|администратор|разработчик|developer|system|оператор|root)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'system_prompt_request', pattern: /\b(show|print|reveal|display|dump|leak|share)\b.{0,36}\b(system prompt|developer prompt|instructions?|hidden prompt|rules?)\b/i },
  { reason: 'ru_prompt_request', pattern: /(?:^|[^\p{L}\p{N}_])(покажи|раскрой|выведи|напечатай|пришли|открой).{0,40}(системн(?:ый|ые|ого)\s+промпт|инструкции|скрыт(?:ый|ые)\s+промпт|правила)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'execute_command', pattern: /\b(execute|run)\b.{0,24}\b(command|shell|terminal|code)\b/i },
  { reason: 'ru_execute_command', pattern: /(?:^|[^\p{L}\p{N}_])(выполни|запусти|исполни).{0,24}(команду|код|скрипт|терминал)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'jailbreak_terms', pattern: /\b(jailbreak|developer mode|do anything now|DAN)\b/i },
  { reason: 'ru_new_instructions', pattern: /(?:^|[^\p{L}\p{N}_])(новые инструкции|следуй новым правилам|теперь следуй|с этого момента).{0,50}(инструкции|правила|команды|указания)(?:$|[^\p{L}\p{N}_])/iu },
  { reason: 'en_new_instructions', pattern: /\b(new instructions|from now on|starting now)\b.{0,50}\b(follow|obey|use)\b.{0,30}\b(instructions?|rules?|commands?)\b/i },
];

function nowIso(now: Date): string {
  return now.toISOString();
}

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  if (isTest) return;

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as GuardStore;
    if (parsed && typeof parsed === 'object') store = parsed;
  } catch {
    store = {};
  }
}

function persist(): void {
  if (isTest) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(store), 'utf-8');
  } catch {
    // Best-effort only: the in-memory store still protects the active process.
  }
}

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectTelegramPromptInjection(text: string): { detected: boolean; reason?: string } {
  const normalized = normalizeText(text);
  if (!normalized) return { detected: false };

  for (const item of INJECTION_PATTERNS) {
    if (item.pattern.test(normalized)) {
      return { detected: true, reason: item.reason };
    }
  }

  return { detected: false };
}

export function evaluateTelegramPromptInjectionGuard(params: {
  chatId: number | string;
  text: string;
  now?: Date;
}): TelegramPromptInjectionGuardResult {
  loadOnce();

  const key = String(params.chatId);
  const now = params.now ?? new Date();
  const existing = store[key];
  const blockedUntilMs = existing ? Date.parse(existing.blockedUntil) : 0;
  const activeBlock = Number.isFinite(blockedUntilMs) && blockedUntilMs > now.getTime();
  const detection = detectTelegramPromptInjection(params.text);

  if (activeBlock && detection.detected) {
    const blockedUntil = new Date(now.getTime() + BLOCK_TTL_MS).toISOString();
    const violationCount = Math.max(2, (existing?.violationCount ?? 1) + 1);
    store[key] = {
      chatId: key,
      blockedUntil,
      violationCount,
      updatedAt: nowIso(now),
    };
    persist();
    return {
      action: 'block_repeat',
      reason: detection.reason ?? 'prompt_injection',
      blockedUntil,
      violationCount,
    };
  }

  if (activeBlock) {
    return { action: 'block_active', blockedUntil: existing!.blockedUntil };
  }

  if (!detection.detected) {
    return { action: 'allow' };
  }

  const blockedUntil = new Date(now.getTime() + BLOCK_TTL_MS).toISOString();
  store[key] = {
    chatId: key,
    blockedUntil,
    violationCount: (existing?.violationCount ?? 0) + 1,
    updatedAt: nowIso(now),
  };
  persist();

  return {
    action: 'block_first',
    reason: detection.reason ?? 'prompt_injection',
    blockedUntil,
  };
}

export function clearTelegramPromptInjectionGuardForChat(chatId: number | string): void {
  loadOnce();
  delete store[String(chatId)];
  persist();
}

export function __resetTelegramPromptInjectionGuardForTests(): void {
  loaded = true;
  store = {};
}
