import { NextResponse } from 'next/server';

import {
  composeCommunicationAutopilotContextReply,
  decideCommunicationAutopilotResponseWithLlmRouter,
  type CommunicationAutopilotContext,
} from '@/lib/communication/autopilot';
import { createChatCompletionsLlmRouterProvider } from '@/lib/communication/llm-router/deepseek-provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  return req.headers.get('x-internal-test-secret') === expected;
}

function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function buildAcceptanceContext(): CommunicationAutopilotContext {
  return {
    session: {
      id: `guest-concierge-http-acceptance-${Date.now()}`,
      language: 'ru',
    },
    booking: {
      id: 'acceptance-booking',
      verified: true,
      lateCheckoutAvailable: false,
    },
    object: {
      id: 'acceptance-object',
      name: 'acceptance-object',
    },
    bookingVerified: true,
    propertyResolved: true,
  };
}

function buildGuestConciergeProvider() {
  if (!bool(process.env.GUEST_CONCIERGE_LLM_ENABLED)) return undefined;

  const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) return undefined;

  return createChatCompletionsLlmRouterProvider({
    providerName: 'openai',
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.GUEST_CONCIERGE_LLM_MODEL || 'gpt-4o-mini',
    timeoutMs: Number(process.env.GUEST_CONCIERGE_LLM_TIMEOUT_MS || 8000),
    maxRetries: Number(process.env.GUEST_CONCIERGE_LLM_MAX_RETRIES || 0),
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const text = String(body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: 'text_required' }, { status: 400 });
  }

  const provider = buildGuestConciergeProvider();
  const decision = await decideCommunicationAutopilotResponseWithLlmRouter({
    channel: 'telegram',
    messageText: text,
    context: buildAcceptanceContext(),
    llmRouterProvider: provider,
  });
  const replyText = composeCommunicationAutopilotContextReply({ decision, lang: 'ru' });

  return NextResponse.json({
    ok: true,
    replyText,
    decision: {
      action: decision.action,
      confidence: decision.confidence,
      escalationReason: decision.escalationReason ?? null,
      intent: decision.metadata.intent,
      urgent: decision.metadata.urgent,
      policy: decision.metadata.policy,
      matchedSignals: decision.metadata.matchedSignals,
      missingContext: decision.metadata.missingContext,
      operationsAction: decision.metadata.operationsAction ?? null,
      wifiEscalation: decision.metadata.wifiEscalation ?? null,
      llmRouter: decision.metadata.llmRouter
        ? {
            used: decision.metadata.llmRouter.used,
            provider: decision.metadata.llmRouter.provider,
            modelName: decision.metadata.llmRouter.modelName ?? null,
            intent: decision.metadata.llmRouter.intent,
            validation: decision.metadata.llmRouter.validation,
            reason: decision.metadata.llmRouter.reason ?? null,
          }
        : { used: false },
      semanticRouter: decision.metadata.semanticRouter
        ? {
            used: decision.metadata.semanticRouter.used,
            source: decision.metadata.semanticRouter.source,
            intent: decision.metadata.semanticRouter.intent,
            topic: decision.metadata.semanticRouter.topic,
            finalIntent: decision.metadata.semanticRouter.finalIntent ?? null,
          }
        : null,
    },
    acceptanceEnv: {
      guestConciergeLlmEnabled: bool(process.env.GUEST_CONCIERGE_LLM_ENABLED),
      guestConciergeLlmModel: process.env.GUEST_CONCIERGE_LLM_MODEL || null,
      guestConciergeProviderReady: Boolean(provider),
    },
  });
}
