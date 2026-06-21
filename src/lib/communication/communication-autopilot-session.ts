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
  if (!raw || typeof raw !== 'object') return {};
  return raw as CommunicationAutopilotSessionMemory;
}

export function patchAutopilotSessionCollectedData(input: {
  collectedData: Record<string, unknown>;
  memory: CommunicationAutopilotSessionMemory;
}): Record<string, string | null | undefined | CommunicationAutopilotSessionMemory> {
  return {
    ...Object.fromEntries(
      Object.entries(input.collectedData).map(([key, value]) => [
        key,
        typeof value === 'string' || value === null || value === undefined ? value : undefined,
      ]),
    ),
    communication_autopilot_session: input.memory,
    communication_autopilot_property_id: input.memory.property_id ?? null,
  };
}
