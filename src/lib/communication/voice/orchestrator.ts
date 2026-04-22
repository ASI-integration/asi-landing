import { randomUUID } from 'crypto';
import { ProcessOutcome, type InboundMessageEnvelope, type ProcessResult } from '../types';
import { processMessage } from '../orchestrator';
import { formatVoiceSafeText } from './formatter';
import { getOrCreateVoiceSession, updateVoiceSession } from './session-store';
import { transitionVoiceState } from './state-machine';
import type { VoiceInput, VoiceOutput, VoiceTurn, VoiceSession } from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function stableUpdateId(): number {
  // Good enough for dev harness and idempotency fallback when no provider ids exist.
  return Date.now();
}

function toUpdateId(input: VoiceInput): number {
  const raw = input.providerUpdateId;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return stableUpdateId();
}

function toEnvelope(input: VoiceInput, voiceSession: VoiceSession, voiceTurnId: string): InboundMessageEnvelope {
  return {
    channel: input.channel,
    externalUserId: input.actorId ?? `voice:${voiceSession.voiceSessionId}`,
    chatId: input.actorId ?? voiceSession.voiceSessionId,
    messageText: input.transcript,
    receivedAt: new Date(),
    update_id: toUpdateId(input),
    metadata: {
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
      ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
      voice: {
        voiceSessionId: voiceSession.voiceSessionId,
        voiceTurnId,
        channel: input.channel,
        actorId: input.actorId ?? null,
        transcriptConfidence: input.transcriptConfidence ?? null,
        audioRef: input.audioRef ?? null,
        providerMediaId: input.providerMediaId ?? null,
        providerMessageId: input.providerMessageId ?? null,
        language: input.language ?? null,
      } satisfies Record<string, unknown>,
    },
  };
}

function buildVoiceOutput(params: {
  mode: VoiceOutput['mode'];
  text: string;
  shouldEndTurn: boolean;
  shouldEscalate: boolean;
}): VoiceOutput {
  return {
    mode: params.mode,
    text: formatVoiceSafeText(params.text),
    shouldEndTurn: params.shouldEndTurn,
    shouldEscalate: params.shouldEscalate,
  };
}

function inferModeFromReply(replyText: string, brainScenario?: string): VoiceOutput['mode'] {
  // Prefer explicit clarify for known clarify flows (scenario engine uses that action).
  const t = replyText.toLowerCase();
  if (t.includes('?')) return 'clarify';
  if (brainScenario && ['payment_issue', 'complaint_conflict'].includes(brainScenario)) return 'handoff';
  return 'speak';
}

export async function handleVoiceTranscript(input: VoiceInput): Promise<{
  session: VoiceSession;
  turn: VoiceTurn;
  brain: ProcessResult;
  output: VoiceOutput;
}> {
  const baseSession = getOrCreateVoiceSession({ channel: input.channel, actorId: input.actorId });

  const started = updateVoiceSession(baseSession.voiceSessionId, {
    state: transitionVoiceState(baseSession.state, 'processing'),
    lastTranscript: input.transcript,
  });

  const voiceTurnId = randomUUID();
  const envelope = toEnvelope(input, started, voiceTurnId);

  let brain: ProcessResult;
  try {
    brain = await processMessage(envelope);
  } catch (err) {
    const failed = updateVoiceSession(started.voiceSessionId, {
      state: transitionVoiceState('processing', 'failed'),
    });
    const turn: VoiceTurn = {
      voiceTurnId,
      voiceSessionId: failed.voiceSessionId,
      channel: input.channel,
      actorId: input.actorId,
      input,
      stateBefore: baseSession.state,
      stateAfter: failed.state,
      createdAt: nowIso(),
    };
    const output = buildVoiceOutput({
      mode: 'handoff',
      text: 'Sorry — something went wrong. I’m passing this to a person to review.',
      shouldEndTurn: true,
      shouldEscalate: true,
    });
    return { session: failed, turn: { ...turn, output }, brain: { outcome: ProcessOutcome.Error }, output };
  }

  const replyText = String(brain.reply ?? '').trim();
  const didEscalate = Boolean(brain.escalation);

  const nextState = didEscalate
    ? transitionVoiceState('processing', 'handoff')
    : transitionVoiceState('processing', 'awaiting_user');

  const updated = updateVoiceSession(started.voiceSessionId, {
    state: nextState,
  });

  const mode = didEscalate ? 'handoff' : inferModeFromReply(replyText, updated.lastDecisionScenario);

  const output = didEscalate
    ? buildVoiceOutput({
        mode,
        text: replyText || "Thanks — I’m handing this to our team and we’ll get back to you shortly.",
        shouldEndTurn: true,
        shouldEscalate: true,
      })
    : buildVoiceOutput({
        mode,
        text: replyText || 'Okay.',
        shouldEndTurn: true,
        shouldEscalate: false,
      });

  const turn: VoiceTurn = {
    voiceTurnId,
    voiceSessionId: updated.voiceSessionId,
    channel: input.channel,
    actorId: input.actorId,
    input,
    output,
    stateBefore: baseSession.state,
    stateAfter: updated.state,
    createdAt: nowIso(),
  };

  return { session: updated, turn, brain, output };
}

