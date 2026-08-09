export type CommunicationAutopilotSessionMemory = {
  property_id?: string | null;
  object_name?: string | null;
  language?: 'ru' | 'en';
  booking_reference?: string | null;
  last_topic?: string | null;
  last_intent?: string | null;
  requested_missing_field?: string | null;
  unresolved_action?: string | null;
  pending_operator_reason?: string | null;
  pending_operator_status?: 'open' | 'resolved' | null;
  last_guest_question?: string | null;
  last_reply?: string | null;
  recent_summary?: string | null;
  last_transport?: string | null;
  turn_count?: number;
  updated_at?: string;
  expires_at?: string;
};

export const COMMUNICATION_AUTOPILOT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TURNS = 20;
const MAX_TURN_TEXT = 240;
const MAX_SUMMARY = 500;

function bounded(value: unknown, max: number): string | null {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeMemory(
  memory: CommunicationAutopilotSessionMemory,
  now: Date,
): CommunicationAutopilotSessionMemory {
  const updatedAt = memory.updated_at && Number.isFinite(Date.parse(memory.updated_at))
    ? memory.updated_at
    : now.toISOString();
  const expiresAt = memory.expires_at && Number.isFinite(Date.parse(memory.expires_at))
    ? memory.expires_at
    : new Date(Date.parse(updatedAt) + COMMUNICATION_AUTOPILOT_SESSION_TTL_MS).toISOString();
  return {
    ...memory,
    language: memory.language === 'en' ? 'en' : 'ru',
    booking_reference: bounded(memory.booking_reference, 40),
    last_guest_question: bounded(memory.last_guest_question, MAX_TURN_TEXT),
    last_reply: bounded(memory.last_reply, MAX_TURN_TEXT),
    recent_summary: bounded(memory.recent_summary, MAX_SUMMARY),
    turn_count: Math.max(0, Math.min(MAX_TURNS, Number(memory.turn_count) || 0)),
    updated_at: updatedAt,
    expires_at: expiresAt,
  };
}

export function mergeAutopilotSessionMemory(
  previous: CommunicationAutopilotSessionMemory | null | undefined,
  patch: CommunicationAutopilotSessionMemory,
): CommunicationAutopilotSessionMemory {
  const now = new Date();
  return normalizeMemory({
    ...(previous ?? {}),
    ...patch,
    turn_count: Math.min(MAX_TURNS, (previous?.turn_count ?? 0) + 1),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + COMMUNICATION_AUTOPILOT_SESSION_TTL_MS).toISOString(),
  }, now);
}

export function autopilotSessionFromCollectedData(
  collected: Record<string, unknown> | null | undefined,
  now = new Date(),
): CommunicationAutopilotSessionMemory {
  const raw = collected?.communication_autopilot_session;
  let parsed: CommunicationAutopilotSessionMemory | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as CommunicationAutopilotSessionMemory;
    } catch {
      return {};
    }
  }
  if (!parsed && raw && typeof raw === 'object') parsed = raw as CommunicationAutopilotSessionMemory;
  if (!parsed) return {};
  const expiresAt = Date.parse(String(parsed.expires_at ?? ''));
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) return {};
  return normalizeMemory(parsed, now);
}

export function patchAutopilotSessionCollectedData(input: {
  memory: CommunicationAutopilotSessionMemory;
}): Record<string, string | null | undefined> {
  const memory = normalizeMemory(input.memory, new Date());
  return {
    communication_autopilot_session: JSON.stringify(memory),
    communication_autopilot_property_id: memory.property_id ?? null,
  };
}
