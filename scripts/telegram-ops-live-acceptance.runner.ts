import {
  buildTelegramOpsAcceptanceMessage,
  cleanupTelegramOpsAcceptanceData,
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
} from '@/lib/communication/telegram-ops-acceptance';
import {
  formatOpsOperatorTasksPreflightFailure,
  getSupabaseHostForLog,
  verifyOpsOperatorTasksTable,
} from '@/lib/ops-board/acceptance-preflight';

const DEFAULT_BASE_URL = 'https://asi-global.ru';
const ESCALATION_REPLY_KEYWORDS = ['оператор', 'передал', 'передала', 'команд', 'поддержк'];

function printError(error: unknown, message?: string): void {
  if (message) {
    console.error(`[telegram-ops-acceptance] FAIL: ${message}`);
  }
  if (error instanceof Error) {
    if (!message || error.message !== message) {
      console.error(`[telegram-ops-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
    return;
  }
  console.error(`[telegram-ops-acceptance] error: ${String(error)}`);
}

function fail(message: string): never {
  console.error(`[telegram-ops-acceptance] FAIL: ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing required env ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getTelegramToken(): { token: string; source: string } {
  const smokeToken = optionalEnv('TELEGRAM_SMOKE_BOT_TOKEN');
  if (smokeToken) return { token: smokeToken, source: 'TELEGRAM_SMOKE_BOT_TOKEN' };
  return { token: requiredEnv('TELEGRAM_BOT_TOKEN'), source: 'TELEGRAM_BOT_TOKEN' };
}

async function tgCall(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Telegram ${method} non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  return { httpStatus: res.status, json };
}

async function tgSendMessage(token: string, chatId: string, text: string) {
  const { httpStatus, json } = await tgCall(token, 'sendMessage', { chat_id: chatId, text });
  if (!json.ok) {
    throw new Error(`Telegram sendMessage failed (${httpStatus}): ${String(json.description ?? 'unknown')}`);
  }
  const result = json.result as { message_id?: number; date?: number } | undefined;
  if (!result?.message_id || !result.date) {
    throw new Error('Telegram sendMessage returned unexpected payload');
  }
  return { messageId: result.message_id, date: result.date };
}

async function tgGetUpdates(token: string, args: Record<string, unknown>) {
  const { httpStatus, json } = await tgCall(token, 'getUpdates', args);
  if (!json.ok) {
    throw new Error(`Telegram getUpdates failed (${httpStatus}): ${String(json.description ?? 'unknown')}`);
  }
  const updates = (json.result as Array<{ update_id: number; message?: Record<string, unknown> }>) ?? [];
  const maxId = updates.reduce((max, item) => Math.max(max, item.update_id), -1);
  return {
    updates,
    nextOffset: maxId >= 0 ? maxId + 1 : Number(args.offset ?? 0),
  };
}

function isBotReply(msg: Record<string, unknown> | undefined, chatIdNum: number, botUsername?: string): boolean {
  if (!msg) return false;
  const chat = msg.chat as { id?: number } | undefined;
  const from = msg.from as { is_bot?: boolean; username?: string } | undefined;
  if (chat?.id !== chatIdNum) return false;
  if (!from?.is_bot) return false;
  if (botUsername && from.username && from.username !== botUsername) return false;
  return typeof msg.text === 'string' && msg.text.trim().length > 0;
}

async function waitForBotReply(input: {
  token: string;
  chatIdNum: number;
  offset: number;
  afterDateUnix: number;
  replyToMessageId: number;
  botUsername?: string;
  timeoutMs: number;
}): Promise<{ text: string; nextOffset: number }> {
  const started = Date.now();
  let offset = input.offset;

  while (Date.now() - started < input.timeoutMs) {
    const { updates, nextOffset } = await tgGetUpdates(input.token, {
      offset,
      timeout: 10,
      limit: 50,
      allowed_updates: ['message'],
    });
    offset = nextOffset;

    const messages = updates.map((item) => item.message).filter(Boolean) as Record<string, unknown>[];
    const candidates = messages
      .filter((msg) => isBotReply(msg, input.chatIdNum, input.botUsername))
      .filter((msg) => Number(msg.date) >= input.afterDateUnix);

    const byReply = candidates.find((msg) => {
      const reply = msg.reply_to_message as { message_id?: number } | undefined;
      return reply?.message_id === input.replyToMessageId;
    });
    const chosen = byReply ?? candidates[0];
    if (chosen && typeof chosen.text === 'string') {
      return { text: chosen.text.trim(), nextOffset: offset };
    }

    await sleep(400);
  }

  throw new Error(`Timed out waiting for bot reply (${input.timeoutMs}ms)`);
}

async function callInternalApi<T>(input: {
  baseUrl: string;
  secret: string;
  body: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/api/internal/telegram-ops-acceptance`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-test-secret': input.secret,
    },
    body: JSON.stringify(input.body),
  });

  const text = await response.text();
  let json: T & { ok?: boolean; error?: string };
  try {
    json = JSON.parse(text) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`invalid internal API JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok && response.status === 403) {
    throw new Error('internal API forbidden: check INTERNAL_TEST_SECRET on production');
  }

  return json;
}

async function pollEscalationReview(input: {
  baseUrl: string;
  secret: string;
  targetId: string;
  marker: string;
  timeoutMs: number;
}) {
  const started = Date.now();
  while (Date.now() - started < input.timeoutMs) {
    const result = await callInternalApi<{
      ok: boolean;
      found: boolean;
      review: { reviewId: string } | null;
    }>({
      baseUrl: input.baseUrl,
      secret: input.secret,
      body: {
        action: 'poll_review',
        chatId: input.targetId,
        marker: input.marker,
      },
    });

    if (result.found && result.review?.reviewId) {
      return result.review.reviewId;
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for pending escalation review (${input.timeoutMs}ms)`);
}

async function runAcceptancePreflight(): Promise<void> {
  console.info('[telegram-ops-acceptance] supabase_host:', getSupabaseHostForLog());
  const preflight = await verifyOpsOperatorTasksTable();
  if (!preflight.ok) {
    console.error(formatOpsOperatorTasksPreflightFailure(preflight.error));
    fail('OPS preflight failed: ops_operator_tasks table unavailable');
  }
}

async function main(): Promise<void> {
  await runAcceptancePreflight();

  const baseUrl = optionalEnv('ACCEPTANCE_BASE_URL') ?? optionalEnv('PRODUCTION_URL') ?? DEFAULT_BASE_URL;
  const secret = requiredEnv('INTERNAL_TEST_SECRET');
  const { token, source: tokenSource } = getTelegramToken();
  const chatIdRaw = requiredEnv('TELEGRAM_TEST_CHAT_ID');
  const botUsername = optionalEnv('TELEGRAM_BOT_USERNAME');

  const mainChatId = optionalEnv('TELEGRAM_CHAT_ID');
  if (mainChatId && mainChatId === chatIdRaw) {
    fail('Refusing to run against TELEGRAM_CHAT_ID — use dedicated TELEGRAM_TEST_CHAT_ID');
  }

  const chatIdNum = Number(chatIdRaw);
  if (!Number.isFinite(chatIdNum)) {
    fail('TELEGRAM_TEST_CHAT_ID must be numeric');
  }

  const runId = Date.now().toString(36);
  const marker = `${TELEGRAM_OPS_ACCEPTANCE_PREFIX}${runId}`;
  const messageText = buildTelegramOpsAcceptanceMessage(runId);

  let reviewId: string | null = null;
  let taskId: string | null = null;
  const failures: string[] = [];

  console.info('[telegram-ops-acceptance] config', {
    baseUrl,
    tokenSource,
    chatId: chatIdRaw,
    marker,
  });

  try {
    let offset = 0;
    {
      const { updates, nextOffset } = await tgGetUpdates(token, { offset, timeout: 0, limit: 100 });
      const maxId = updates.reduce((max, item) => Math.max(max, item.update_id), -1);
      offset = maxId >= 0 ? maxId + 1 : nextOffset;
    }

    const sent = await tgSendMessage(token, chatIdRaw, messageText);
    console.info('[telegram-ops-acceptance] sent telegram message', {
      messageId: sent.messageId,
      textPreview: messageText.slice(0, 80),
    });

    const botReply = await waitForBotReply({
      token,
      chatIdNum,
      offset,
      afterDateUnix: sent.date,
      replyToMessageId: sent.messageId,
      botUsername,
      timeoutMs: 90_000,
    });
    console.info('[telegram-ops-acceptance] bot reply received', {
      preview: botReply.text.slice(0, 120),
    });

    const matchedEscalation = ESCALATION_REPLY_KEYWORDS.filter((keyword) =>
      botReply.text.toLocaleLowerCase('ru-RU').includes(keyword),
    );
    if (matchedEscalation.length === 0) {
      failures.push('bot reply does not look like operator escalation handoff');
    }

    reviewId = await pollEscalationReview({
      baseUrl,
      secret,
      targetId: chatIdRaw,
      marker,
      timeoutMs: 90_000,
    });
    console.info('[telegram-ops-acceptance] pending escalation review found', { reviewId });

    const verify = await callInternalApi<{
      ok: boolean;
      failures: string[];
      taskId: string | null;
      firstSync: { created: number; scanned: number };
      secondSync: { created: number; scanned: number };
    }>({
      baseUrl,
      secret,
      body: {
        action: 'verify_ops',
        reviewId,
      },
    });

    console.info('[telegram-ops-acceptance] first sync', verify.firstSync);
    console.info('[telegram-ops-acceptance] second sync', verify.secondSync);

    if (!verify.ok) {
      failures.push(...(verify.failures ?? []));
    } else {
      taskId = verify.taskId;
    }

    if (taskId) {
      const lifecycle = await callInternalApi<{ ok: boolean; failures: string[] }>({
        baseUrl,
        secret,
        body: {
          action: 'lifecycle',
          taskId,
        },
      });
      if (!lifecycle.ok) {
        failures.push(...(lifecycle.failures ?? []));
      } else {
        console.info('[telegram-ops-acceptance] lifecycle ok (done → active reopen)');
      }
    }

    if (failures.length > 0) {
      console.error('[telegram-ops-acceptance] FAIL');
      for (const item of failures) console.error('  -', item);
      process.exit(1);
    }

    console.log('[telegram-ops-acceptance] PASS');
  } catch (error) {
    printError(error);
    console.error('[telegram-ops-acceptance] FAIL: acceptance runner failed');
    process.exit(1);
  } finally {
    if (reviewId || taskId) {
      try {
        await callInternalApi({
          baseUrl,
          secret,
          body: {
            action: 'cleanup',
            reviewId,
            taskId,
          },
        });
      } catch (error) {
        await cleanupTelegramOpsAcceptanceData({ reviewId, taskId }).catch((cleanupError) => {
          const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          console.warn('[telegram-ops-acceptance] local cleanup warning:', detail);
        });
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[telegram-ops-acceptance] remote cleanup warning:', detail);
      }
    }
  }
}

main().catch((error) => {
  printError(error);
  console.error('[telegram-ops-acceptance] FAIL: acceptance runner failed');
  process.exit(1);
});
