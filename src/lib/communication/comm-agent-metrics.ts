import type { CommunicationAutopilotAction, CommunicationAutopilotIntent } from './autopilot';
import type { WifiBookingRequestReason } from './wifi-escalation-policy';
import type { CommunicationChannel } from './types';

export type CommAgentMetricsPayload = {
  channel: CommunicationChannel;
  session_key: string;
  intent: CommunicationAutopilotIntent | string;
  confidence: number;
  action: CommunicationAutopilotAction | string;
  source: 'policy_guard' | 'llm_router' | 'deterministic_fallback' | 'deterministic_mvp' | 'session_continuation';
  memory_used: boolean;
  booking_resolved: boolean;
  operator_needed: boolean;
  auto_reply_allowed: boolean;
  chat_id?: number;
  update_id?: number;
  semantic_router_used?: boolean;
  semantic_source?: string;
  semantic_model?: string;
  mvp_intent?: string;
  semantic_intent?: string;
  semantic_confidence?: number;
  final_intent?: string;
  semantic_override_applied?: boolean;
  override_reason?: string;
  reply_text?: string;
  object_resolved?: boolean;
  escalation_needed?: boolean;
  booking_request_reason?: WifiBookingRequestReason;
  operational_outcome?: 'auto_resolved' | 'clarification' | 'operator_handoff' | 'safety_blocked';
  language?: 'ru' | 'en' | string;
  transport?: string;
  handoff_reason?: string;
  handoff_urgency?: string;
  safety_blocked_action?: boolean;
};

const SECRET_PATTERNS = [
  /\b\d{10,15}\b/g,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  /(парол[ья]?|password|wifi|wi-fi|вайфай)\s*[:=]\s*\S+/gi,
  /(код\s+доступа|door\s+code|access\s+code)\s*[:=]\s*\S+/gi,
];

function maskSecretsInPreview(text: string, max = 80): string {
  let t = String(text ?? '').slice(0, max);
  for (const re of SECRET_PATTERNS) {
    t = t.replace(re, '[redacted]');
  }
  return t;
}

/** Structured stdout metrics — safe for log pipelines; no secrets or full PII. */
export function logCommAgentMetrics(payload: CommAgentMetricsPayload): void {
  const record = {
    'comm.agent.intent': payload.intent,
    'comm.agent.confidence': Math.round(payload.confidence * 1000) / 1000,
    'comm.agent.action': payload.action,
    'comm.agent.source': payload.source,
    'comm.agent.memory_used': payload.memory_used,
    'comm.agent.booking_resolved': payload.booking_resolved,
    'comm.agent.operator_needed': payload.operator_needed,
    'comm.agent.auto_reply_allowed': payload.auto_reply_allowed,
    channel: payload.channel,
    session_key: payload.session_key,
    ...(payload.chat_id !== undefined ? { chat_id: payload.chat_id } : {}),
    ...(payload.update_id !== undefined ? { update_id: payload.update_id } : {}),
    ...(payload.semantic_router_used !== undefined ? { semantic_router_used: payload.semantic_router_used } : {}),
    ...(payload.semantic_source !== undefined ? { semantic_source: payload.semantic_source } : {}),
    ...(payload.semantic_model !== undefined ? { semantic_model: payload.semantic_model } : {}),
    ...(payload.mvp_intent !== undefined ? { mvp_intent: payload.mvp_intent } : {}),
    ...(payload.semantic_intent !== undefined ? { semantic_intent: payload.semantic_intent } : {}),
    ...(payload.semantic_confidence !== undefined ? { semantic_confidence: payload.semantic_confidence } : {}),
    ...(payload.final_intent !== undefined ? { final_intent: payload.final_intent } : {}),
    ...(payload.semantic_override_applied !== undefined
      ? { semantic_override_applied: payload.semantic_override_applied }
      : {}),
    ...(payload.override_reason !== undefined ? { override_reason: payload.override_reason } : {}),
    ...(payload.reply_text !== undefined ? { reply_text: maskSecretsInPreview(payload.reply_text, 240) } : {}),
    ...(payload.object_resolved !== undefined ? { object_resolved: payload.object_resolved } : {}),
    ...(payload.escalation_needed !== undefined ? { escalation_needed: payload.escalation_needed } : {}),
    ...(payload.booking_request_reason !== undefined
      ? { booking_request_reason: payload.booking_request_reason }
      : {}),
    ...(payload.operational_outcome ? { 'comm.agent.operational_outcome': payload.operational_outcome } : {}),
    ...(payload.language ? { 'comm.agent.language': payload.language } : {}),
    ...(payload.transport ? { 'comm.agent.transport': payload.transport } : {}),
    ...(payload.handoff_reason ? { 'comm.agent.handoff_reason': payload.handoff_reason } : {}),
    ...(payload.handoff_urgency ? { 'comm.agent.handoff_urgency': payload.handoff_urgency } : {}),
    ...(payload.safety_blocked_action !== undefined
      ? { 'comm.agent.safety_blocked_action': payload.safety_blocked_action }
      : {}),
  };
  console.log(JSON.stringify(record));
}

export function logCommAgentHandoffLifecycleMetric(params: {
  channel: CommunicationChannel;
  session_key: string;
  event: 'created' | 'duplicate_suppressed' | 'resolved' | 'reply_duplicate_suppressed';
  reason: string;
}): void {
  console.log(JSON.stringify({
    'comm.agent.handoff_event': params.event,
    channel: params.channel,
    session_key: params.session_key,
    reason: String(params.reason ?? '').slice(0, 120),
    duplicate_suppressed:
      params.event === 'duplicate_suppressed' || params.event === 'reply_duplicate_suppressed',
  }));
}

export function logCommAgentHandoffPreview(params: {
  channel: CommunicationChannel;
  session_key: string;
  reason: string;
  urgency: string;
  guest_message_preview?: string;
}): void {
  console.log(
    JSON.stringify({
      'comm.agent.operator_handoff': true,
      channel: params.channel,
      session_key: params.session_key,
      reason: params.reason,
      urgency: params.urgency,
      guest_message_preview: params.guest_message_preview
        ? maskSecretsInPreview(params.guest_message_preview)
        : undefined,
    }),
  );
}
