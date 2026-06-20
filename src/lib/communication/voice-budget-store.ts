import * as fs from 'fs';
import * as path from 'path';

type ChatVoiceBudget = {
  date: string;
  chatId: number;
  replyCount: number;
  estimatedSeconds: number;
};

type GlobalVoiceBudget = {
  month: string;
  estimatedSeconds: number;
  replyCount: number;
};

function budgetDir(): string {
  const env =
    process.env.SESSION_STORE_DIR ??
    process.env.COMM_STATE_DIR ??
    process.env.CONVERSATION_SESSION_DIR ??
    process.env.STATE_DIR;
  if (env && String(env).trim()) return String(env);
  return path.join(process.cwd(), '.asi-comm-state');
}

function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function utcMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch {
    // Non-fatal: budget is best-effort protection.
  }
}

export type VoiceBudgetSnapshot = {
  dailyReplyCount: number;
  dailyEstimatedSeconds: number;
  monthlyEstimatedSeconds: number;
  dailyCapReached: boolean;
  monthlyCapReached: boolean;
};

export function getVoiceBudgetSnapshot(chatId: number, now = new Date()): VoiceBudgetSnapshot {
  if (process.env.NODE_ENV === 'test') {
    return {
      dailyReplyCount: 0,
      dailyEstimatedSeconds: 0,
      monthlyEstimatedSeconds: 0,
      dailyCapReached: false,
      monthlyCapReached: false,
    };
  }

  const dailyLimit = Number(process.env.VOICE_DAILY_REPLY_LIMIT_PER_CHAT ?? '30');
  const dailySecondsLimit = Number(process.env.VOICE_DAILY_SECONDS_LIMIT_PER_CHAT ?? '900');
  const monthlySecondsLimit = Number(process.env.VOICE_MONTHLY_SECONDS_LIMIT_GLOBAL ?? '36000');

  const chatFile = path.join(budgetDir(), `voice-budget-chat-${chatId}-${utcDateKey(now)}.json`);
  const globalFile = path.join(budgetDir(), `voice-budget-global-${utcMonthKey(now)}.json`);

  const chat = readJson<ChatVoiceBudget>(chatFile);
  const global = readJson<GlobalVoiceBudget>(globalFile);

  const dailyReplyCount = chat?.replyCount ?? 0;
  const dailyEstimatedSeconds = chat?.estimatedSeconds ?? 0;
  const monthlyEstimatedSeconds = global?.estimatedSeconds ?? 0;

  return {
    dailyReplyCount,
    dailyEstimatedSeconds,
    monthlyEstimatedSeconds,
    dailyCapReached:
      (Number.isFinite(dailyLimit) && dailyLimit > 0 && dailyReplyCount >= dailyLimit) ||
      (Number.isFinite(dailySecondsLimit) && dailySecondsLimit > 0 && dailyEstimatedSeconds >= dailySecondsLimit),
    monthlyCapReached:
      Number.isFinite(monthlySecondsLimit) && monthlySecondsLimit > 0 && monthlyEstimatedSeconds >= monthlySecondsLimit,
  };
}

export function recordVoiceBudgetUsage(params: {
  chatId: number;
  estimatedSeconds: number;
  now?: Date;
}): void {
  if (process.env.NODE_ENV === 'test') return;

  const now = params.now ?? new Date();
  const chatFile = path.join(budgetDir(), `voice-budget-chat-${params.chatId}-${utcDateKey(now)}.json`);
  const globalFile = path.join(budgetDir(), `voice-budget-global-${utcMonthKey(now)}.json`);

  const chat = readJson<ChatVoiceBudget>(chatFile) ?? {
    date: utcDateKey(now),
    chatId: params.chatId,
    replyCount: 0,
    estimatedSeconds: 0,
  };
  chat.replyCount += 1;
  chat.estimatedSeconds += Math.max(1, Math.round(params.estimatedSeconds));

  const global = readJson<GlobalVoiceBudget>(globalFile) ?? {
    month: utcMonthKey(now),
    estimatedSeconds: 0,
    replyCount: 0,
  };
  global.replyCount += 1;
  global.estimatedSeconds += Math.max(1, Math.round(params.estimatedSeconds));

  writeJson(chatFile, chat);
  writeJson(globalFile, global);
}

/** Test helper */
export function __resetVoiceBudgetStoreForTests(): void {
  // No-op: tests use NODE_ENV=test short-circuit.
}
