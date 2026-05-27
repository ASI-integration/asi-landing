import { AuditEvent, AuditEventType } from './types';

/**
 * Structured audit logger.
 *
 * All events are written as a single JSON line to stdout via console.log so
 * they are trivially parseable by any log aggregator (Datadog, Loki, etc.).
 *
 * Rules enforced here:
 * - No raw message bodies — only truncated previews (≤ 100 chars).
 * - No secrets, tokens, or API keys.
 * - Every event carries a UTC ISO timestamp.
 */

export function auditLog(event: Omit<AuditEvent, 'ts'>): void {
  const record: AuditEvent = {
    ...event,
    ts: new Date().toISOString(),
  };
  // Single-line JSON — safe for structured log pipelines.
  console.log(JSON.stringify({ audit: record }));
}

// ─── Convenience factories ────────────────────────────────────────────────────

export function auditInbound(params: {
  chat_id: number;
  update_id: number;
  text: string | undefined;
  category?: AuditEvent['category'];
  lang?: AuditEvent['lang'];
}): void {
  auditLog({
    type: AuditEventType.InboundReceived,
    chat_id: params.chat_id,
    update_id: params.update_id,
    message_preview: truncate(params.text, 100),
    category: params.category,
    lang: params.lang,
  });
}

export function auditOutbound(params: {
  chat_id: number;
  update_id?: number;
  category?: AuditEvent['category'];
  lang?: AuditEvent['lang'];
  detail?: string;
}): void {
  auditLog({
    type: AuditEventType.OutboundSent,
    chat_id: params.chat_id,
    update_id: params.update_id,
    category: params.category,
    lang: params.lang,
    detail: params.detail,
  });
}

export function auditDuplicate(params: { chat_id?: number; update_id: number }): void {
  auditLog({
    type: AuditEventType.DuplicateDropped,
    chat_id: params.chat_id,
    update_id: params.update_id,
  });
}

export function auditDuplicateOutboundPrevented(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.DuplicatePreventedOutbound,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

export function auditDecision(params: {
  type: 'reply' | 'ignore' | 'escalate';
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  const t =
    params.type === 'reply'
      ? AuditEventType.DecisionReply
      : params.type === 'ignore'
        ? AuditEventType.DecisionIgnore
        : AuditEventType.DecisionEscalate;
  auditLog({
    type: t,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

export function auditRetryAttempt(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.RetryAttempt,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

export function auditFailureEnqueued(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.FailureEnqueued,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

export function auditLLM(params: {
  chat_id: number;
  update_id?: number;
  used_fallback: boolean;
}): void {
  auditLog({
    type: params.used_fallback ? AuditEventType.LLMFallback : AuditEventType.LLMCalled,
    chat_id: params.chat_id,
    update_id: params.update_id,
  });
}

export function auditLlmRouter(params: {
  chat_id: number;
  update_id?: number;
  marker: keyof typeof LLM_ROUTER_AUDIT_TYPES;
  detail?: string;
}): void {
  auditLog({
    type: LLM_ROUTER_AUDIT_TYPES[params.marker],
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

const LLM_ROUTER_AUDIT_TYPES = {
  LLM_ROUTER_CANON_HIGH_CONFIDENCE: AuditEventType.LLMRouterCanonHighConfidence,
  LLM_ROUTER_PRIMARY_USED: AuditEventType.LLMRouterPrimaryUsed,
  LLM_ROUTER_PRIMARY_FAILED: AuditEventType.LLMRouterPrimaryFailed,
  LLM_ROUTER_SECONDARY_USED: AuditEventType.LLMRouterSecondaryUsed,
  LLM_ROUTER_PREMIUM_USED: AuditEventType.LLMRouterPremiumUsed,
  LLM_ROUTER_VALIDATION_FAILED: AuditEventType.LLMRouterValidationFailed,
  LLM_ROUTER_SAFE_FALLBACK_USED: AuditEventType.LLMRouterSafeFallbackUsed,
  LLM_ROUTER_STICKY_PROVIDER_SET: AuditEventType.LLMRouterStickyProviderSet,
  LLM_ROUTER_STICKY_PROVIDER_USED: AuditEventType.LLMRouterStickyProviderUsed,
} as const;

export function auditEscalation(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.EscalationCreated,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

/** Rule-based autonomous layer: one line per decision for log pipelines. */
export function auditAutonomousDecision(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.AutonomousDecision,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

/**
 * Identity binding decision logger.
 * Use this for "who/what did we resolve" + confidence + why.
 */
export function auditIdentityDecision(params: {
  chat_id: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.IdentityDecision,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

export function auditError(params: {
  chat_id?: number;
  update_id?: number;
  detail: string;
}): void {
  auditLog({
    type: AuditEventType.UnhandledError,
    chat_id: params.chat_id,
    update_id: params.update_id,
    detail: params.detail,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length <= max ? text : text.slice(0, max) + '…';
}
