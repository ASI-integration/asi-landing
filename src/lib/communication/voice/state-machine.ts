import type { VoiceSessionState } from './types';

export type VoiceStateTransition =
  | { from: 'listening'; to: 'processing' }
  | { from: 'processing'; to: 'awaiting_user' }
  | { from: 'processing'; to: 'handoff' }
  | { from: 'processing'; to: 'completed' }
  | { from: 'processing'; to: 'failed' }
  | { from: 'awaiting_user'; to: 'processing' }
  | { from: 'handoff'; to: 'processing' };

const ALLOWED: Record<VoiceSessionState, Set<VoiceSessionState>> = {
  listening: new Set(['processing']),
  processing: new Set(['awaiting_user', 'handoff', 'completed', 'failed']),
  awaiting_user: new Set(['processing']),
  handoff: new Set(['processing']),
  completed: new Set([]),
  failed: new Set([]),
};

export function canTransitionVoiceState(from: VoiceSessionState, to: VoiceSessionState): boolean {
  return Boolean(ALLOWED[from]?.has(to));
}

export function transitionVoiceState(from: VoiceSessionState, to: VoiceSessionState): VoiceSessionState {
  if (!canTransitionVoiceState(from, to)) {
    throw new Error(`invalid_voice_state_transition:${from}->${to}`);
  }
  return to;
}

