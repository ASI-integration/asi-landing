import { buildTelegramSemanticRouterPrompt } from './prompt';
import { classifyTelegramGuestSemanticDeterministic } from './deterministic';
import { parseTelegramSemanticRouterJson, validateTelegramSemanticRouterResult } from './validate';
import type {
  TelegramSemanticRouterChainResult,
  TelegramSemanticRouterInput,
  TelegramSemanticRouterProvider,
  TelegramSemanticRouterProviderName,
  TelegramSemanticRouterResult,
} from './types';

type ChatProviderConfig = {
  providerName: TelegramSemanticRouterProviderName;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function createChatSemanticRouterProvider(config: ChatProviderConfig): TelegramSemanticRouterProvider {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = config.model ?? 'gpt-4o-mini';
  const timeoutMs = config.timeoutMs ?? 5000;

  return {
    name: config.providerName,
    modelName: model,
    async classify(input: TelegramSemanticRouterInput): Promise<TelegramSemanticRouterResult> {
      const response = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'Ты строгий JSON semantic router. Верни только JSON, без пояснений.',
              },
              { role: 'user', content: buildTelegramSemanticRouterPrompt(input) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
          }),
        },
        timeoutMs,
      );

      if (!response.ok) {
        throw new Error(`semantic_router_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content?.trim()) throw new Error('semantic_router_empty_content');

      const parsed = parseTelegramSemanticRouterJson(content);
      const validated = validateTelegramSemanticRouterResult(parsed, 'llm');
      if (!validated.ok) throw new Error(validated.reason);
      return validated.result;
    },
  };
}

export function createDisabledTelegramSemanticRouterProvider(): TelegramSemanticRouterProvider {
  return {
    name: 'disabled',
    modelName: 'disabled',
    async classify() {
      throw new Error('semantic_router_disabled');
    },
  };
}

export function getConfiguredTelegramSemanticRouterProvider(): TelegramSemanticRouterProvider {
  const configured = String(
    process.env.TELEGRAM_SEMANTIC_ROUTER_PROVIDER ?? process.env.LLM_ROUTER_PRIMARY_PROVIDER ?? 'disabled',
  ).toLowerCase() as TelegramSemanticRouterProviderName;

  if (configured === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return createDisabledTelegramSemanticRouterProvider();
    return createChatSemanticRouterProvider({
      providerName: 'deepseek',
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.TELEGRAM_SEMANTIC_ROUTER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      timeoutMs: num(process.env.TELEGRAM_SEMANTIC_ROUTER_TIMEOUT_MS, 5000),
    });
  }

  if (configured === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
    if (!apiKey) return createDisabledTelegramSemanticRouterProvider();
    return createChatSemanticRouterProvider({
      providerName: 'openai',
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.TELEGRAM_SEMANTIC_ROUTER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      timeoutMs: num(process.env.TELEGRAM_SEMANTIC_ROUTER_TIMEOUT_MS, 5000),
    });
  }

  return createDisabledTelegramSemanticRouterProvider();
}

export function isTelegramSemanticRouterEnabled(): boolean {
  return bool(process.env.TELEGRAM_SEMANTIC_ROUTER_ENABLED, false);
}

export async function routeTelegramGuestSemantic(
  input: TelegramSemanticRouterInput,
  providerOverride?: TelegramSemanticRouterProvider,
): Promise<TelegramSemanticRouterChainResult> {
  const fallback = classifyTelegramGuestSemanticDeterministic(input.messageText);

  if (!isTelegramSemanticRouterEnabled() && !providerOverride) {
    return { ok: true, result: fallback, provider: 'disabled' };
  }

  const provider = providerOverride ?? getConfiguredTelegramSemanticRouterProvider();
  if (provider.name === 'disabled') {
    return { ok: true, result: fallback, provider: 'disabled' };
  }

  try {
    const result = await provider.classify(input);
    if (result.confidence < 0.65) {
      return { ok: false, reason: 'low_confidence', fallback };
    }
    if (
      result.intent === 'wifi_access' &&
      classifyTelegramGuestSemanticDeterministic(input.messageText).intent === 'wifi_problem'
    ) {
      return { ok: false, reason: 'wifi_access_conflicts_with_deterministic_problem', fallback };
    }
    if (
      result.intent === 'waste_disposal_info' &&
      classifyTelegramGuestSemanticDeterministic(input.messageText).intent === 'cleaning_issue'
    ) {
      return { ok: false, reason: 'waste_conflicts_with_deterministic_cleaning', fallback };
    }
    return { ok: true, result, provider: provider.name, modelName: provider.modelName };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 80) : 'provider_failed',
      fallback,
    };
  }
}
