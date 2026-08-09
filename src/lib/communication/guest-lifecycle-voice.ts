import { prepareTelegramVoiceAudio } from './voice-audio';
import { isVoiceReplyGloballyEnabled, sendTelegramVoice } from './voice-reply';
import { generateSpeech } from './voice-tts';

export type GuestLifecycleVoiceInput = {
  channel: string;
  targetId: string;
  text: string;
  communicationMode: unknown;
};

/**
 * Adds an optional voice copy only after the readable text has succeeded.
 * TTS/provider/audio failures are deliberately non-fatal; generateSpeech()
 * retains the configured ElevenLabs -> OpenAI fallback chain.
 */
export async function sendGuestLifecycleVoiceCopy(input: GuestLifecycleVoiceInput): Promise<boolean> {
  if (input.channel !== 'telegram' || input.communicationMode !== 'voice') return false;
  if (!isVoiceReplyGloballyEnabled()) return false;
  try {
    const speech = await generateSpeech(input.text);
    if (!speech.audio) return false;
    const prepared = prepareTelegramVoiceAudio(speech.audio, speech.format);
    if (!prepared.oggBytes) return false;
    return await sendTelegramVoice(input.targetId, prepared.oggBytes);
  } catch {
    return false;
  }
}
