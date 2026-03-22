const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SEND_TIMEOUT_MS = 8000;

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

    if (!res.ok) {
      console.error(`[Telegram] Send failed (attempt=${attempt}):`, await res.text());
      return false;
    }
    return true;
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

async function sendWithRetry(url: string, body: Record<string, unknown>): Promise<boolean> {
  const ok = await sendWithTimeout(url, body, 1);
  if (ok) return true;
  // One retry for transient failures (timeout / network blip)
  console.warn('[Telegram] Retrying send (attempt=2)');
  return sendWithTimeout(url, body, 2);
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  return sendWithRetry(url, { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
}

export async function replyToTelegram(chatId: number | string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] Missing TELEGRAM_BOT_TOKEN for reply');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  return sendWithRetry(url, { chat_id: chatId, text });
}
