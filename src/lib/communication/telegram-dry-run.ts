import { processMessage } from './orchestrator';
import { executeTelegramOperationalPolicyMultiIntent } from './telegram-operational-policy-executor';
import { resolveTelegramTextMeta } from './telegram-text-meta-handler';
import type { InboundMessageEnvelope, ProcessResult } from './types';

export type TelegramDryRunInput = {
  text: string;
  chatId: string;
  objectName?: string;
  bookingId?: string;
};

export type TelegramDryRunOutput = {
  detectedIntents: string[];
  replyText: string;
  actions: string[];
  escalated: boolean;
  slowAckSent: boolean;
  finalReplied: boolean;
};

function toOperationalAction(action: string): string {
  if (action === 'auto_reply') return 'reply';
  if (action === 'slow_ack') return 'slow_ack';
  if (action === 'escalate') return 'escalate_operator';
  return action;
}

function scenarioToIntent(scenario: string): string {
  return String(scenario ?? '').toLowerCase();
}

function withTemporaryDryRun<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.TELEGRAM_DRY_RUN;
  process.env.TELEGRAM_DRY_RUN = '1';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.TELEGRAM_DRY_RUN;
    else process.env.TELEGRAM_DRY_RUN = prev;
  });
}

export async function runTelegramDryRun(input: TelegramDryRunInput): Promise<TelegramDryRunOutput> {
  const text = String(input.text ?? '').trim();
  const chatId = String(input.chatId ?? '').trim();
  const objectName = String(input.objectName ?? '').trim();
  const bookingId = String(input.bookingId ?? '').trim();
  const meta = resolveTelegramTextMeta({ baseText: text, telegramLangCode: 'ru' });

  const policyInput = {
    messageText: text,
    update_id: Date.now(),
    knownContext: {
      objectLabel: objectName || null,
      bookingReference: bookingId || null,
      cleaningStatusKnown: false,
    },
    sessionMemory: {
      knownContext: {
        objectLabel: objectName || null,
        bookingReference: bookingId || null,
        cleaningStatusKnown: false,
      },
      lastScenarioFamily: null,
      lastSlowAckUpdateId: null,
      unknownOperationalAttemptCount: 0,
    },
  } as const;

  const multiIntent = meta ? null : executeTelegramOperationalPolicyMultiIntent(policyInput);
  const detectedIntents = multiIntent?.intents.map((intent) => scenarioToIntent(intent.scenarioFamily)) ?? [];
  const actions = multiIntent?.intents.map((intent) => toOperationalAction(intent.action)) ?? [];

  const envelope: InboundMessageEnvelope = {
    channel: 'telegram',
    externalUserId: chatId,
    chatId,
    messageText: text,
    receivedAt: new Date(),
    update_id: Date.now(),
    metadata: {
      providerMessageId: `dryrun-${Date.now()}`,
      externalMessageId: `dryrun-${Date.now()}`,
      telegram_user_language_code: 'ru',
    },
  };

  const result: ProcessResult = await withTemporaryDryRun(() => processMessage(envelope));
  const replyText = result.reply ?? '';
  const escalatedByPolicy = actions.includes('escalate_operator') || actions.includes('escalate_urgent');
  const hasFinalPolicyAction = actions.some((action) => action === 'reply' || action === 'clarify' || action.startsWith('escalate'));
  const hasFinalMetaReply = Boolean(meta && replyText.length > 0);

  return {
    detectedIntents,
    replyText,
    actions,
    escalated: Boolean(result.escalation) || escalatedByPolicy,
    slowAckSent: actions.includes('slow_ack') && !hasFinalPolicyAction,
    finalReplied: result.outcome === 'replied' && replyText.length > 0 && (hasFinalPolicyAction || hasFinalMetaReply),
  };
}
