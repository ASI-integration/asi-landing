import type { VoiceInput, VoiceOutput, VoiceChannel, VoiceSession, VoiceTurn } from './types';

export type NormalizedVoiceEvent = {
  input: VoiceInput;
  raw?: unknown;
};

export interface VoiceAdapter {
  channel: VoiceChannel;

  /**
   * Convert an inbound provider event into a normalized transcript-first input.
   * Provider integrations will implement this later.
   */
  normalizeVoiceEvent(raw: unknown): Promise<NormalizedVoiceEvent>;

  /**
   * Build a channel-appropriate output wrapper from plain text.
   */
  buildVoiceOutput(params: {
    session: VoiceSession;
    turn: VoiceTurn;
    text: string;
    mode: VoiceOutput['mode'];
    shouldEndTurn: boolean;
    shouldEscalate: boolean;
  }): VoiceOutput;

  /**
   * Send output back to the channel (stubbed for now).
   */
  sendVoiceOutput(_output: VoiceOutput): Promise<boolean>;
}

