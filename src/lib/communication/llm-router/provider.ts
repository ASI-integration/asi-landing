import {
  createChatCompletionsLlmRouterProvider,
  createDeepSeekLlmRouterProvider,
} from './deepseek-provider';
import { validateLlmRouterDecision } from './validate-llm-router-decision';
import type {
  LlmRouterAttemptAudit,
  LlmRouterChainResult,
  LlmRouterDecision,
  LlmRouterInput,
  LlmRouterProvider,
  LlmRouterProviderName,
} from './types';

type ProviderRole = 'primary' | 'secondary' | 'premium' | 'fixed';

type StickyProvider = {
  provider: LlmRouterProviderName;
  expiresAt: number;
  remainingMessages: number;
};

const stickyProviders = new Map<string, StickyProvider>();

function cleanKeyPart(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 160) : undefined;
}

function stickyProviderKey(input: LlmRouterInput): string | undefined {
  const bookingId = cleanKeyPart(input.bookingId);
  if (bookingId) return `booking:${bookingId}`;

  const conversationId = cleanKeyPart(input.conversationId);
  if (conversationId) return `conversation:${conversationId}`;

  const sessionId = cleanKeyPart(input.sessionId);
  if (sessionId) return `session:${sessionId}`;

  const chatId = cleanKeyPart(input.chatId);
  if (chatId) return `chat:${chatId}`;

  return undefined;
}

export function createDisabledLlmRouterProvider(): LlmRouterProvider {
  return {
    name: 'disabled',
    modelName: 'disabled',
    async classifyGuestMessage(_input: LlmRouterInput) {
      throw new Error('llm_router_disabled');
    },
  };
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNum(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function providerFromName(name: LlmRouterProviderName, role: ProviderRole): LlmRouterProvider {
  if (name === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return createDisabledLlmRouterProvider();
    return createDeepSeekLlmRouterProvider({
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      timeoutMs: num(
        role === 'primary' ? process.env.LLM_ROUTER_PRIMARY_TIMEOUT_MS : process.env.LLM_ROUTER_TIMEOUT_MS,
        role === 'primary' ? 5000 : 6000,
      ),
      maxRetries: nonNegativeNum(process.env.LLM_ROUTER_MAX_RETRIES, 1),
    });
  }

  if (name === 'openai' || name === 'openai-premium') {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
    if (!apiKey) return createDisabledLlmRouterProvider();
    return createChatCompletionsLlmRouterProvider({
      providerName: name,
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model:
        name === 'openai-premium'
          ? process.env.OPENAI_PREMIUM_MODEL || 'gpt-5-mini'
          : process.env.OPENAI_MODEL || 'gpt-5-nano',
      timeoutMs: num(
        role === 'primary' ? process.env.LLM_ROUTER_PRIMARY_TIMEOUT_MS : process.env.LLM_ROUTER_SECONDARY_TIMEOUT_MS,
        role === 'primary' ? 5000 : 6000,
      ),
      maxRetries: nonNegativeNum(process.env.LLM_ROUTER_MAX_RETRIES, 1),
    });
  }

  return createDisabledLlmRouterProvider();
}

export function getConfiguredLlmRouterProvider(): LlmRouterProvider {
  const legacy = process.env.LLM_ROUTER_PROVIDER as LlmRouterProviderName | undefined;
  const configured = (legacy ?? process.env.LLM_ROUTER_PRIMARY_PROVIDER ?? 'disabled').toLowerCase() as LlmRouterProviderName;
  return providerFromName(configured, 'fixed');
}

export function getConfiguredLlmRouterProviderChain(input: LlmRouterInput): Array<{
  role: ProviderRole;
  provider: LlmRouterProvider;
}> {
  const mode = String(process.env.LLM_ROUTER_MODE ?? 'fixed').toLowerCase();
  if (mode !== 'auto' || !bool(process.env.LLM_ROUTER_AUTO_FALLBACK_ENABLED, true)) {
    return [{ role: 'fixed', provider: getConfiguredLlmRouterProvider() }];
  }

  const primaryName = (process.env.LLM_ROUTER_PRIMARY_PROVIDER ?? process.env.LLM_ROUTER_PROVIDER ?? 'deepseek').toLowerCase() as LlmRouterProviderName;
  const secondaryName = (process.env.LLM_ROUTER_SECONDARY_PROVIDER ?? 'openai').toLowerCase() as LlmRouterProviderName;
  const premiumName = (process.env.LLM_ROUTER_TERTIARY_PROVIDER ?? 'openai-premium').toLowerCase() as LlmRouterProviderName;
  const chain: Array<{ role: ProviderRole; provider: LlmRouterProvider }> = [];

  const stickyKey = stickyProviderKey(input);
  const sticky = stickyKey ? stickyProviders.get(stickyKey) : undefined;
  if (sticky && sticky.expiresAt > Date.now() && sticky.remainingMessages > 0) {
    sticky.remainingMessages -= 1;
    chain.push({ role: 'secondary', provider: providerFromName(sticky.provider, 'secondary') });
  } else {
    if (stickyKey && sticky) stickyProviders.delete(stickyKey);
    chain.push({ role: 'primary', provider: providerFromName(primaryName, 'primary') });
  }

  if (input.forceStrongerProvider && chain[0]?.provider.name === 'deepseek') {
    chain.unshift({ role: 'secondary', provider: providerFromName(secondaryName, 'secondary') });
  }

  chain.push({ role: 'secondary', provider: providerFromName(secondaryName, 'secondary') });
  chain.push({ role: 'premium', provider: providerFromName(premiumName, 'premium') });

  const seen = new Set<string>();
  return chain.filter(({ provider }) => {
    const key = `${provider.name}:${provider.modelName ?? ''}`;
    if (provider.name === 'disabled' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function classifyWithConfiguredLlmRouter(input: LlmRouterInput): Promise<LlmRouterChainResult> {
  const chain = getConfiguredLlmRouterProviderChain(input);
  const maxAttempts =
    String(process.env.LLM_ROUTER_MODE ?? 'fixed').toLowerCase() === 'auto'
      ? num(process.env.LLM_ROUTER_MAX_PROVIDER_ATTEMPTS, 2)
      : 1;
  const attempts: LlmRouterAttemptAudit[] = [];

  const stickyKey = stickyProviderKey(input);
  const sticky = stickyKey ? stickyProviders.get(stickyKey) : undefined;
  if (sticky && sticky.expiresAt > Date.now() && sticky.remainingMessages >= 0) {
    attempts.push({
      marker: 'LLM_ROUTER_STICKY_PROVIDER_USED',
      provider: sticky.provider,
      validation: 'skipped',
      fallbackPath: 'sticky_provider',
    });
  }

  for (const { role, provider } of chain.slice(0, maxAttempts)) {
    const usedMarker: LlmRouterAttemptAudit['marker'] =
      role === 'primary'
        ? 'LLM_ROUTER_PRIMARY_USED'
        : role === 'premium'
          ? 'LLM_ROUTER_PREMIUM_USED'
          : 'LLM_ROUTER_SECONDARY_USED';
    const started = Date.now();
    const usedAttempt: LlmRouterAttemptAudit = {
      marker: usedMarker,
      provider: provider.name,
      modelName: provider.modelName,
      validation: 'skipped',
      fallbackPath: role,
    };
    attempts.push(usedAttempt);

    try {
      const decision = await provider.classifyGuestMessage(input);
      const validation = validateRouterQuality(input, decision);
      const latencyMs = Date.now() - started;
      if (validation.ok) {
        Object.assign(usedAttempt, {
          provider: provider.name,
          modelName: provider.modelName,
          latencyMs,
          normalizedIntent: decision.intent,
          confidence: decision.confidence,
          validation: 'accepted',
          fallbackPath: role,
          finalActionType: decision.actionType,
          finalShouldEscalate: decision.shouldEscalate,
        });
        setStickyProvider(input, provider, role, attempts);
        return { ok: true, decision, provider: provider.name, modelName: provider.modelName, attempts };
      }

      attempts.push({
        marker: role === 'primary' ? 'LLM_ROUTER_PRIMARY_FAILED' : 'LLM_ROUTER_VALIDATION_FAILED',
        provider: provider.name,
        modelName: provider.modelName,
        latencyMs,
        failureReason: validation.reason,
        normalizedIntent: decision.intent,
        confidence: decision.confidence,
        validation: validation.reason === 'low_confidence' ? 'low_confidence' : 'rejected',
        fallbackPath: role,
        finalActionType: decision.actionType,
        finalShouldEscalate: decision.shouldEscalate,
      });
    } catch (error) {
      attempts.push({
        marker: role === 'primary' ? 'LLM_ROUTER_PRIMARY_FAILED' : 'LLM_ROUTER_VALIDATION_FAILED',
        provider: provider.name,
        modelName: provider.modelName,
        latencyMs: Date.now() - started,
        failureReason: error instanceof Error ? error.message.slice(0, 80) : 'provider_failed',
        validation: 'provider_failed',
        fallbackPath: role,
      });
    }
  }

  attempts.push({
    marker: 'LLM_ROUTER_SAFE_FALLBACK_USED',
    provider: 'disabled',
    validation: 'skipped',
    fallbackPath: 'safe_fallback',
  });
  return { ok: false, reason: 'all_providers_failed', attempts };
}

function validateRouterQuality(
  input: LlmRouterInput,
  decision: LlmRouterDecision,
): { ok: true } | { ok: false; reason: string } {
  const strict = validateLlmRouterDecision(decision);
  if (!strict.ok) return { ok: false, reason: strict.reason };
  if (decision.confidence < 0.7) return { ok: false, reason: 'low_confidence' };
  if (isUrgentAccessText(input.messageText) && !(decision.intent === 'access_problem' && decision.shouldEscalate)) {
    return { ok: false, reason: 'urgent_access_not_escalated' };
  }
  if (input.forceStrongerProvider && decision.intent === 'unknown') {
    return { ok: false, reason: 'misunderstanding_loop_unknown' };
  }
  return { ok: true };
}

function isUrgentAccessText(text: string): boolean {
  const normalized = text.toLocaleLowerCase('ru-RU');
  return /(стою|у\s+двери|снаружи|не\s+могу\s+(попасть|войти|зайти)|код\s+не\s+работает|дверь\s+не\s+открывается|замок\s+не\s+открывается)/i.test(
    normalized,
  );
}

function setStickyProvider(
  input: LlmRouterInput,
  provider: LlmRouterProvider,
  role: ProviderRole,
  attempts: LlmRouterAttemptAudit[],
): void {
  const stickyKey = stickyProviderKey(input);
  if (!stickyKey || role === 'primary' || provider.name === 'disabled' || provider.name === 'deepseek') return;
  stickyProviders.set(stickyKey, {
    provider: provider.name,
    expiresAt: Date.now() + num(process.env.LLM_ROUTER_STICKY_PROVIDER_TTL_MINUTES, 15) * 60_000,
    remainingMessages: 5,
  });
  attempts.push({
    marker: 'LLM_ROUTER_STICKY_PROVIDER_SET',
    provider: provider.name,
    modelName: provider.modelName,
    validation: 'accepted',
    fallbackPath: 'sticky_provider',
  });
}

export function __resetLlmRouterStickyProvidersForTests(): void {
  stickyProviders.clear();
}
