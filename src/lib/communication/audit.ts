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
