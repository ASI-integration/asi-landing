import {
  isTelegramOutboundDryRun,
  shouldSuppressTelegramOutbound,
} from '@/lib/communication/telegram-outbound-safe-mode';

/**
 * Important: do NOT read env once at module load.
 * In Vercel/Next serverless builds, module-scope env reads can be surprisingly
 * sticky across build/runtime boundaries. Always read on call.
 */
// Outbound Telegram sends use runtime TELEGRAM_BOT_TOKEN; changing local helper env files alone does not change production bot identity.
function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

function getTelegramChatId(): string | null {
  const t = process.env.TELEGRAM_CHAT_ID;
  return t && t.trim().length > 0 ? t.trim() : null;
}

const SEND_TIMEOUT_MS = (() => {
  const raw = process.env.TELEGRAM_HTTP_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 15000;
})();

type TelegramApiResponse =
  | { ok: true; result?: { message_id?: number } }
  | { ok: false; error_code?: number; description?: string };

function outboundDebugEnabled(): boolean {
  return process.env.TELEGRAM_OUTBOUND_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1';
}

function safePreview(text: string, max = 200): string {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function sendWithTimeout(
  url: string,
  body: Record<string, unknown>,
  attempt: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let parsed: TelegramApiResponse | null = null;
    try {
      parsed = JSON.parse(rawText) as TelegramApiResponse;
    } catch {
      parsed = null;
    }

    const chat_id = body?.chat_id;
    const tgOk = parsed?.ok;

    // Telegram can return HTTP 200 with { ok:false, ... } for API-level errors.
    const success = res.ok && tgOk !== false;

    if (outboundDebugEnabled()) {
      const desc =
        parsed && parsed.ok === false
          ? { error_code: parsed.error_code ?? null, description: parsed.description ?? null }
          : null;
      const msgId = parsed && parsed.ok === true ? parsed.result?.message_id ?? null : null;
      console.log('[Telegram] sendMessage result', {
        attempt,
        http_status: res.status,
        chat_id: typeof chat_id === 'string' || typeof chat_id === 'number' ? String(chat_id) : null,
        tg_ok: typeof tgOk === 'boolean' ? tgOk : null,
        message_id: msgId,
        error: desc,
      });
    }

    if (!res.ok) {
      console.error('[Telegram] sendMessage http failure', {
        attempt,
        http_status: res.status,
        body_preview: safePreview(rawText, 500),
      });
      return false;
    }

    if (parsed && parsed.ok === false) {
      console.error('[Telegram] sendMessage api failure', {
        attempt,
        http_status: res.status,
        error_code: parsed.error_code ?? null,
        description: parsed.description ?? null,
      });
      return false;
    }

    if (!parsed) {
      // Unexpected non-JSON response: treat as failure to avoid false positives.
      console.error('[Telegram] sendMessage unexpected response', {
        attempt,
        http_status: res.status,
        body_preview: safePreview(rawText, 500),
      });
      return false;
    }

    return success;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`[Telegram] Outbound timeout after ${SEND_TIMEOUT_MS}ms (attempt=${attempt})`);
    } else {
      console.error(`[Telegram] Network error (attempt=${attempt}):`, (err as Error).message ?? err);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sendOnce(url: string, body: Record<string, unknown>): Promise<boolean> {
  const ok = await sendWithTimeout(url, body, 1);
  if (!ok) {
    console.error('[Telegram] Outbound send failed (single attempt); delivery layer controls retries');
  }
  return ok;
}

export type TelegramReplyLogContext = {
  /** Stable tag for logs: which code path produced this outbound (e.g. orchestrator:llm). */
  handler: string;
  update_id?: number;
  reply_markup?: Record<string, unknown>;
};

export type TelegramChatActionLogContext = {
  handler?: string;
  update_id?: number;
  throttleMs?: number;
};

const chatActionLastSentAt = new Map<string, number>();

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
  const TELEGRAM_CHAT_ID = getTelegramChatId();
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return false;
  }

  if (isTelegramOutboundDryRun()) {
    if (outboundDebugEnabled()) {
      console.log('[Telegram] DRY_RUN sendTelegramMessage suppressed', {
        chat_id: String(TELEGRAM_CHAT_ID),
        text_preview: safePreview(String(text ?? ''), 160),
      });
    }
    return true;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  // Keep global ops notifications simple/plain. If HTML is needed in the future,
  // add escaping and an explicit parse_mode flag.
  return sendOnce(url, { chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true });
}

export async function replyToTelegram(
  chatId: number | string,
  text: string,
  logCtx?: TelegramReplyLogContext,
): Promise<boolean> {
  const sendStartedAt = Date.now();
  const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN for reply');
    return false;
  }

  if (logCtx?.handler) {
    console.info('[tg:reply:handler]', {
      handler: logCtx.handler,
      chat_id: String(chatId),
      update_id: logCtx.update_id ?? null,
    });
  }

  if (shouldSuppressTelegramOutbound(chatId)) {
    if (outboundDebugEnabled()) {
      console.log('[Telegram] outbound suppressed', {
        chat_id: String(chatId),
        dry_run: isTelegramOutboundDryRun(),
        text_preview: safePreview(String(text ?? ''), 160),
      });
    }
    return true;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  if (outboundDebugEnabled()) {
    console.log('[Telegram] reply attempt', {
      chat_id: String(chatId),
      text_preview: safePreview(String(text ?? ''), 160),
    });
  }
  const sent = await sendOnce(url, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: logCtx?.reply_markup ?? { remove_keyboard: true },
  });
  console.info('[tg:latency] telegram.send', {
    chat_id: String(chatId),
    update_id: logCtx?.update_id ?? null,
    handler: logCtx?.handler ?? null,
    stage_ms: Date.now() - sendStartedAt,
    sent,
  });
  return sent;
}

export async function sendTelegramChatAction(
  chatId: number | string,
  action: 'typing' = 'typing',
  logCtx?: TelegramChatActionLogContext,
): Promise<boolean> {
  const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN for chat action');
    return false;
  }

  const throttleMs = Number.isFinite(logCtx?.throttleMs) ? Number(logCtx?.throttleMs) : 4_000;
  const key = `${chatId}:${action}`;
  const now = Date.now();
  const last = chatActionLastSentAt.get(key) ?? 0;
  if (last > 0 && now - last < throttleMs) {
    if (outboundDebugEnabled()) {
      console.log('[Telegram] chat action throttled', {
        chat_id: String(chatId),
        action,
        handler: logCtx?.handler ?? null,
        update_id: logCtx?.update_id ?? null,
      });
    }
    return true;
  }
  chatActionLastSentAt.set(key, now);

  if (shouldSuppressTelegramOutbound(chatId)) return true;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;
  const sent = await sendOnce(url, { chat_id: chatId, action });
  console.info('[tg:latency] telegram.chat_action', {
    chat_id: String(chatId),
    update_id: logCtx?.update_id ?? null,
    handler: logCtx?.handler ?? null,
    action,
    sent,
  });
  return sent;
}

export async function answerTelegramCallbackQuery(callbackQueryId: string): Promise<boolean> {
  const TELEGRAM_BOT_TOKEN = getTelegramBotToken();
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN for callback answer');
    return false;
  }

  if (isTelegramOutboundDryRun()) return true;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  return sendOnce(url, { callback_query_id: callbackQueryId });
}
