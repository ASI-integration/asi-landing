import type { VoiceChannel, VoiceChannelCapabilities } from './types';

export const VOICE_CHANNEL_CAPABILITIES: Record<VoiceChannel, VoiceChannelCapabilities> = {
  whatsapp_voice: {
    supportsAsyncVoice: true,
    supportsPushToTalk: true,
    supportsLiveCall: false,
    supportsTranscriptInput: true,
    supportsAudioReply: true,
    supportsOperatorBridge: true,
  },
  telegram_voice: {
    supportsAsyncVoice: true,
    supportsPushToTalk: true,
    supportsLiveCall: false,
    supportsTranscriptInput: true,
    supportsAudioReply: true,
    supportsOperatorBridge: true,
  },
  phone: {
    supportsAsyncVoice: false,
    supportsPushToTalk: false,
    supportsLiveCall: true,
    supportsTranscriptInput: true,
    supportsAudioReply: true,
    supportsOperatorBridge: true,
  },
};

