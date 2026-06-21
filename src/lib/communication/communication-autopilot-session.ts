export type CommunicationAutopilotSessionMemory = {
  property_id?: string | null;
  object_name?: string | null;
  last_topic?: string | null;
  last_intent?: string | null;
  last_guest_question?: string | null;
  last_reply?: string | null;
  turn_count?: number;
};

export function mergeAutopilotSessionMemory(
  previous: CommunicationAutopilotSessionMemory | null | undefined,
  patch: CommunicationAutopilotSessionMemory,
): CommunicationAutopilotSessionMemory {
  return {
    ...(previous ?? {}),
    ...patch,
    turn_count: (previous?.turn_count ?? 0) + 1,
  };
}

export function autopilotSessionFromCollectedData(
  collected: Record<string, unknown> | null | undefined,
): CommunicationAutopilotSessionMemory {
  const raw = collected?.communication_autopilot_session;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as CommunicationAutopilotSessionMemory;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') return raw as CommunicationAutopilotSessionMemory;
  return {};
}

export function patchAutopilotSessionCollectedData(input: {
  memory: CommunicationAutopilotSessionMemory;
}): Record<string, string | null | undefined> {
  return {
    communication_autopilot_session: JSON.stringify(input.memory),
    communication_autopilot_property_id: input.memory.property_id ?? null,
  };
}
