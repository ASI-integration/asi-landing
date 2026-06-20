import { transcribeWithWhisper } from '@/lib/communication/voice/whisper';
import type { WhatsAppSttResult } from './types';

function mimeTypeToExt(mimeType?: string): string {
  if (!mimeType) return '.ogg';
  const m = mimeType.toLowerCase();
  if (m.includes('ogg')) return '.ogg';
  if (m.includes('mp4') || m.includes('m4a')) return '.m4a';
  if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
  if (m.includes('wav')) return '.wav';
  if (m.includes('webm')) return '.webm';
  if (m.includes('opus')) return '.opus';
  return '.ogg';
}

export async function transcribeWhatsAppAudio(params: {
  audioBuffer: ArrayBuffer;
  mimeType?: string;
}): Promise<WhatsAppSttResult | null> {
  const ext = mimeTypeToExt(params.mimeType);
  const filename = `whatsapp_voice${ext}`;
  const r = await transcribeWithWhisper({ audioBuffer: params.audioBuffer, filename, mimeType: params.mimeType });
  if (!r) return null;
  return { transcript: r.text, confidence: r.confidence };
}

