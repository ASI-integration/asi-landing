/**
 * Production Telegram long-poll ingress for bots that use getUpdates
 * (ASI_COMM_Test_Bot and any non-webhook consumer).
 *
 * Contract:
 * - allowed_updates always includes callback_query
 * - updates without top-level message are not dropped (callback_query routes)
 * - offset advances only after an update is handled (incl. ignored)
 * - exclusive consumer: deleteWebhook before polling; one offset stream
 */

import type { TelegramUpdate } from './types';

export const TELEGRAM_POLLER_ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'callback_query',
] as const;

export type TelegramPollerAllowedUpdate = (typeof TELEGRAM_POLLER_ALLOWED_UPDATES)[number];

export type TelegramPollerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TelegramPollerProcessResult = {
  outcome: string;
  update_id?: number;
  chat_id?: number;
  reply?: string;
  [key: string]: unknown;
};

export type TelegramPollerRoute =
  | { kind: 'voice' }
  | { kind: 'processUpdate' }
  | { kind: 'ignore'; reason: string };

export type TelegramGetUpdatesResponse = {
  ok: boolean;
  description?: string;
  result?: TelegramUpdate[];
};

export type TelegramPollerApiClient = {
  getUpdates: (args: {
    offset: number;
    timeout?: number;
    limit?: number;
    allowed_updates?: readonly string[];
  }) => Promise<TelegramGetUpdatesResponse>;
  deleteWebhook?: (args?: { drop_pending_updates?: boolean }) => Promise<{ ok: boolean }>;
  getWebhookInfo?: () => Promise<{ ok: boolean; result?: { url?: string } }>;
};

export function extractTelegramUpdateChatId(update: TelegramUpdate): number | undefined {
  const fromMessage = update.message?.chat?.id ?? update.edited_message?.chat?.id;
  if (typeof fromMessage === 'number') return fromMessage;
  const fromCallback = update.callback_query?.message?.chat?.id;
  if (typeof fromCallback === 'number') return fromCallback;
  return undefined;
}

export function extractTelegramCallbackFrom(update: TelegramUpdate): {
  id?: string;
  data?: string;
  fromId?: number;
  chatId?: number;
  messageId?: number;
} | null {
  const callback = update.callback_query;
  if (!callback) return null;
  return {
    id: callback.id,
    data: callback.data,
    fromId: callback.from?.id,
    chatId: callback.message?.chat?.id,
    messageId: callback.message?.message_id,
  };
}

export function classifyTelegramPollerUpdate(update: TelegramUpdate): TelegramPollerRoute {
  if (update.callback_query) {
    return { kind: 'processUpdate' };
  }
  const message = update.edited_message ?? update.message;
  if (!message) {
    return { kind: 'ignore', reason: 'no_message_or_callback' };
  }
  if (message.voice || message.audio) {
    return { kind: 'voice' };
  }
  return { kind: 'processUpdate' };
}

export function assertPollerAllowsCallbackQuery(allowedUpdates: readonly string[]): void {
  if (!allowedUpdates.includes('callback_query')) {
    throw new Error(
      'TELEGRAM_POLLER_ALLOWED_UPDATES must include callback_query; callbacks would never be ingested',
    );
  }
}

export function createTelegramBotApiClient(params: {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: TelegramPollerFetch;
}): TelegramPollerApiClient {
  const apiBaseUrl = (params.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/$/, '');
  const fetchImpl = params.fetchImpl ?? fetch;

  async function call(method: string, body?: Record<string, unknown>) {
    const res = await fetchImpl(`${apiBaseUrl}/bot${params.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async getUpdates(args) {
      const allowed =
        args.allowed_updates ?? ([...TELEGRAM_POLLER_ALLOWED_UPDATES] as string[]);
      return (await call('getUpdates', {
        offset: args.offset,
        timeout: args.timeout ?? 0,
        limit: args.limit ?? 50,
        allowed_updates: [...allowed],
      })) as TelegramGetUpdatesResponse;
    },
    async deleteWebhook(args) {
      return (await call('deleteWebhook', {
        drop_pending_updates: Boolean(args?.drop_pending_updates),
      })) as { ok: boolean };
    },
    async getWebhookInfo() {
      return (await call('getWebhookInfo')) as { ok: boolean; result?: { url?: string } };
    },
  };
}

export type PollAndProcessTelegramUpdatesParams = {
  api: TelegramPollerApiClient;
  offset: number;
  timeout?: number;
  limit?: number;
  /** Override only for negative tests; production must keep callback_query. */
  allowedUpdates?: readonly string[];
  skipAllowedUpdatesAssert?: boolean;
  processUpdate: (update: TelegramUpdate) => Promise<TelegramPollerProcessResult>;
  processTelegramVoiceUpdate?: (update: TelegramUpdate) => Promise<TelegramPollerProcessResult>;
  /** Optional chat allow-list (ASI_COMM_Test_Bot owner chat). */
  allowedChatIds?: ReadonlySet<number> | readonly number[];
  processedUpdateIds?: Set<number>;
  onOffsetCommit?: (nextOffset: number) => void | Promise<void>;
  ensureExclusiveConsumer?: boolean;
};

export type PollAndProcessTelegramUpdatesResult = {
  nextOffset: number;
  fetched: number;
  handled: Array<{
    update_id: number;
    chat_id?: number;
    route: TelegramPollerRoute;
    result?: TelegramPollerProcessResult;
    ignored?: boolean;
    reason?: string;
  }>;
  getUpdatesAllowedUpdates: string[];
};

function chatAllowed(
  chatId: number | undefined,
  allowed: ReadonlySet<number> | readonly number[] | undefined,
): boolean {
  if (!allowed) return true;
  if (typeof chatId !== 'number') return false;
  if (allowed instanceof Set) return allowed.has(chatId);
  return (allowed as readonly number[]).includes(chatId);
}

/**
 * One getUpdates cycle → route each update through the same production handlers.
 * Offset is committed only after each update is handled (success, ignore, or error-safe skip).
 */
export async function pollAndProcessTelegramUpdates(
  params: PollAndProcessTelegramUpdatesParams,
): Promise<PollAndProcessTelegramUpdatesResult> {
  const allowedUpdates = params.allowedUpdates
    ? [...params.allowedUpdates]
    : [...TELEGRAM_POLLER_ALLOWED_UPDATES];

  if (!params.skipAllowedUpdatesAssert) {
    assertPollerAllowsCallbackQuery(allowedUpdates);
  }

  if (params.ensureExclusiveConsumer) {
    const info = await params.api.getWebhookInfo?.();
    if (info?.result?.url) {
      await params.api.deleteWebhook?.({ drop_pending_updates: false });
    }
  }

  const resp = await params.api.getUpdates({
    offset: params.offset,
    timeout: params.timeout ?? 0,
    limit: params.limit ?? 50,
    allowed_updates: allowedUpdates,
  });

  if (!resp.ok) {
    throw new Error(`getUpdates failed: ${resp.description ?? 'unknown'}`);
  }

  const updates = resp.result ?? [];
  let nextOffset = params.offset;
  const handled: PollAndProcessTelegramUpdatesResult['handled'] = [];
  const seen = params.processedUpdateIds ?? new Set<number>();

  for (const update of updates) {
    const updateId = update.update_id;
    const chatId = extractTelegramUpdateChatId(update);
    const route = classifyTelegramPollerUpdate(update);

    if (seen.has(updateId)) {
      handled.push({
        update_id: updateId,
        chat_id: chatId,
        route,
        ignored: true,
        reason: 'duplicate_update_id',
      });
      nextOffset = Math.max(nextOffset, updateId + 1);
      await params.onOffsetCommit?.(nextOffset);
      continue;
    }

    if (!chatAllowed(chatId, params.allowedChatIds)) {
      handled.push({
        update_id: updateId,
        chat_id: chatId,
        route,
        ignored: true,
        reason: 'foreign_or_missing_chat',
      });
      seen.add(updateId);
      nextOffset = Math.max(nextOffset, updateId + 1);
      await params.onOffsetCommit?.(nextOffset);
      continue;
    }

    if (route.kind === 'ignore') {
      handled.push({
        update_id: updateId,
        chat_id: chatId,
        route,
        ignored: true,
        reason: route.reason,
      });
      seen.add(updateId);
      nextOffset = Math.max(nextOffset, updateId + 1);
      await params.onOffsetCommit?.(nextOffset);
      continue;
    }

    let result: TelegramPollerProcessResult;
    if (route.kind === 'voice') {
      if (!params.processTelegramVoiceUpdate) {
        handled.push({
          update_id: updateId,
          chat_id: chatId,
          route,
          ignored: true,
          reason: 'voice_handler_missing',
        });
        seen.add(updateId);
        nextOffset = Math.max(nextOffset, updateId + 1);
        await params.onOffsetCommit?.(nextOffset);
        continue;
      }
      result = await params.processTelegramVoiceUpdate(update);
    } else {
      result = await params.processUpdate(update);
    }

    handled.push({ update_id: updateId, chat_id: chatId, route, result });
    seen.add(updateId);
    // Offset advances only after successful handling of this update.
    nextOffset = Math.max(nextOffset, updateId + 1);
    await params.onOffsetCommit?.(nextOffset);
  }

  return {
    nextOffset,
    fetched: updates.length,
    handled,
    getUpdatesAllowedUpdates: allowedUpdates,
  };
}
