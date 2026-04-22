export type VoiceChannel = 'whatsapp_voice' | 'telegram_voice' | 'phone';

export type VoiceSessionState =
  | 'listening'
  | 'processing'
  | 'awaiting_user'
  | 'handoff'
  | 'completed'
  | 'failed';

export type VoiceSession = {
  voiceSessionId: string;
  sessionId?: string;
  channel: VoiceChannel;
  actorId?: string;
  state: VoiceSessionState;
  lastTranscript?: string;
  lastDecisionScenario?: string;
  createdAt: string;
  updatedAt: string;
};

export type VoiceTurn = {
  voiceTurnId: string;
  voiceSessionId: string;
  channel: VoiceChannel;
  actorId?: string;
  input: VoiceInput;
  output?: VoiceOutput;
  stateBefore: VoiceSessionState;
  stateAfter: VoiceSessionState;
  createdAt: string;
};

export type VoiceInput = {
  channel: VoiceChannel;
  actorId?: string;
  transcript: string;
  transcriptConfidence?: number;
  audioRef?: string;
  language?: string;
};

export type VoiceOutputMode = 'speak' | 'handoff' | 'clarify' | 'confirm';

export type VoiceOutput = {
  mode: VoiceOutputMode;
  text: string;
  shouldEndTurn: boolean;
  shouldEscalate: boolean;
};

export type VoiceChannelCapabilities = {
  supportsAsyncVoice: boolean;
  supportsPushToTalk: boolean;
  supportsLiveCall: boolean;
  supportsTranscriptInput: boolean;
  supportsAudioReply: boolean;
  supportsOperatorBridge: boolean;
};

export type VoiceHandoffPayload = {
  source: 'voice';
  voiceChannel: VoiceChannel;
  voiceSessionId: string;
  voiceTurnId: string;
  transcript: string;
  transcriptConfidence?: number;
  lastDecisionScenario?: string;
  missingFacts?: string[];
};

