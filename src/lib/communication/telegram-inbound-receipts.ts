import { randomUUID } from 'crypto';

import { supabase } from '@/lib/supabase';

import {
  createOrUpdateEscalationReview,
  forceCloseActiveReviewForSession,
  OperatorReviewStoreUnavailableError,
} from './operator-review';
import { sha256Base64Url } from './reliability';
import type { TelegramUpdate } from './types';

const BOT_SCOPE = 'core';

type TenantScope = {
  accountId: string | null;
  propertyId: string | null;
};

export type TelegramInboundClaim =
  | {
      action: 'process';
      receiptId: string;
      claimToken: string;
      retryCount: number;
      scope: TenantScope;
      update: TelegramUpdate;
    }
  | {
      action: 'duplicate';
      receiptId: string;
      retryCount: number;
      scope: TenantScope;
    }
  | {
      action: 'busy';
      receiptId: string;
      retryCount: number;
      scope: TenantScope;
    };

type ClaimRow = {
  action: 'process' | 'duplicate' | 'busy';
  receipt_id: string;
  claim_token: string | null;
  retry_count: number;
  account_id: string | null;
  property_id: string | null;
  payload: TelegramUpdate;
};

function receiptReviewSessionId(receiptId: string): string {
  return `telegram_inbound_failure:${receiptId}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function eventMetadata(update: TelegramUpdate): {
  eventKind: string;
  chatId: number | null;
  messageId: number | null;
} {
  const eventKind = update.callback_query
    ? 'callback_query'
    : update.edited_message
      ? 'edited_message'
      : update.message
        ? 'message'
        : 'unknown';
  const message = update.edited_message ?? update.message ?? update.callback_query?.message;
  return {
    eventKind,
    chatId: typeof message?.chat?.id === 'number' ? message.chat.id : null,
    messageId: typeof message?.message_id === 'number' ? message.message_id : null,
  };
}

async function resolveServerOwnedScope(chatId: number | null): Promise<TenantScope> {
  if (chatId === null) return { accountId: null, propertyId: null };

  const { data: session } = await supabase
    .from('tg_conversation_sessions')
    .select('property_id')
    .eq('chat_id', chatId)
    .maybeSingle();
  const propertyId = typeof session?.property_id === 'string' && session.property_id.trim()
    ? session.property_id.trim()
    : null;
  if (!propertyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(propertyId)) {
    return { accountId: null, propertyId };
  }

  const { data: property } = await supabase
    .from('properties')
    .select('account_id')
    .eq('id', propertyId)
    .maybeSingle();
  const accountId = typeof property?.account_id === 'string' && property.account_id.trim()
    ? property.account_id.trim()
    : null;
  return { accountId, propertyId };
}

function parseClaimRow(data: unknown): ClaimRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('telegram_inbound_receipt_claim_empty');
  return row as ClaimRow;
}

export async function claimTelegramInboundReceipt(update: TelegramUpdate): Promise<TelegramInboundClaim> {
  if (!Number.isSafeInteger(update.update_id)) throw new Error('telegram_update_id_required');
  const metadata = eventMetadata(update);
  const scope = await resolveServerOwnedScope(metadata.chatId);
  const payloadHash = sha256Base64Url(stableJson(update));
  const claimToken = randomUUID();
  const { data, error } = await supabase.rpc('claim_telegram_inbound_receipt', {
    p_bot_scope: BOT_SCOPE,
    p_update_id: update.update_id,
    p_event_kind: metadata.eventKind,
    p_chat_id: metadata.chatId,
    p_message_id: metadata.messageId,
    p_payload: update,
    p_payload_hash: payloadHash,
    p_account_id: scope.accountId,
    p_property_id: scope.propertyId,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(`telegram_inbound_receipt_claim_failed:${error.message}`);

  const row = parseClaimRow(data);
  const storedScope = { accountId: row.account_id, propertyId: row.property_id };
  if (row.action !== 'process') {
    return {
      action: row.action,
      receiptId: row.receipt_id,
      retryCount: row.retry_count,
      scope: storedScope,
    };
  }
  if (!row.claim_token) throw new Error('telegram_inbound_receipt_claim_token_missing');
  return {
    action: 'process',
    receiptId: row.receipt_id,
    claimToken: row.claim_token,
    retryCount: row.retry_count,
    scope: storedScope,
    update: row.payload,
  };
}

export async function claimTelegramInboundReceiptForRetry(params: {
  receiptId: string;
  expectedAccountId: string;
  expectedPropertyId?: string | null;
}): Promise<Extract<TelegramInboundClaim, { action: 'process' }>> {
  const claimToken = randomUUID();
  const { data, error } = await supabase.rpc('claim_telegram_inbound_receipt_retry', {
    p_receipt_id: params.receiptId,
    p_expected_account_id: params.expectedAccountId,
    p_expected_property_id: params.expectedPropertyId ?? null,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(`telegram_inbound_receipt_retry_claim_failed:${error.message}`);
  const row = parseClaimRow(data);
  if (row.action !== 'process' || !row.claim_token) {
    throw new Error(`telegram_inbound_receipt_retry_unavailable:${row.action}`);
  }
  return {
    action: 'process',
    receiptId: row.receipt_id,
    claimToken: row.claim_token,
    retryCount: row.retry_count,
    scope: { accountId: row.account_id, propertyId: row.property_id },
    update: row.payload,
  };
}

async function transitionReceipt(params: {
  receiptId: string;
  claimToken: string;
  status: 'processed' | 'failed';
  outcome: string;
  failureCode?: string | null;
  operatorReviewId?: string | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc('complete_telegram_inbound_receipt', {
    p_receipt_id: params.receiptId,
    p_claim_token: params.claimToken,
    p_status: params.status,
    p_process_outcome: params.outcome,
    p_failure_code: params.failureCode ?? null,
    p_operator_review_id: params.operatorReviewId ?? null,
  });
  if (error || data !== true) {
    throw new Error(`telegram_inbound_receipt_transition_failed:${error?.message ?? 'claim_lost'}`);
  }
}

export async function completeTelegramInboundReceipt(params: {
  claim: Extract<TelegramInboundClaim, { action: 'process' }>;
  outcome: string;
}): Promise<void> {
  await transitionReceipt({
    receiptId: params.claim.receiptId,
    claimToken: params.claim.claimToken,
    status: 'processed',
    outcome: params.outcome,
  });
  // Best-effort cleanup: the inbound receipt has already been durably marked
  // processed above, so an unavailable operator-review store must not turn
  // an otherwise-successful message into a reported processing failure.
  try {
    forceCloseActiveReviewForSession({
      sessionId: receiptReviewSessionId(params.claim.receiptId),
      operatorId: 'telegram_inbound_recovery',
      reason: 'inbound_retry_processed',
    });
  } catch (err) {
    if (!(err instanceof OperatorReviewStoreUnavailableError)) throw err;
  }
}

export async function failTelegramInboundReceipt(params: {
  claim: Extract<TelegramInboundClaim, { action: 'process' }>;
  failureCode: 'process_outcome_error' | 'processing_threw';
}): Promise<void> {
  const metadata = eventMetadata(params.claim.update);
  const review = createOrUpdateEscalationReview({
    sessionId: receiptReviewSessionId(params.claim.receiptId),
    channel: 'telegram',
    targetId: String(metadata.chatId ?? ''),
    actorId: metadata.chatId === null ? undefined : String(metadata.chatId),
    role: 'guest',
    propertyId: params.claim.scope.propertyId ?? undefined,
    escalationReason: 'INBOUND_PROCESSING_FAILED',
    source: {
      event: 'telegram_inbound_processing_failed',
      receipt_id: params.claim.receiptId,
      update_id: params.claim.update.update_id,
      retry_count: params.claim.retryCount,
      failure_code: params.failureCode,
    },
    detail: 'Входящее сообщение не обработано. Нужна проверка или повторная обработка.',
  });
  await transitionReceipt({
    receiptId: params.claim.receiptId,
    claimToken: params.claim.claimToken,
    status: 'failed',
    outcome: 'error',
    failureCode: params.failureCode,
    operatorReviewId: review.reviewId,
  });
}
