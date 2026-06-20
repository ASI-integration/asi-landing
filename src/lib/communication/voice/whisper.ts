// Deprecated: the Telegram voice pipeline now uses `voice/stt.ts` with explicit provider selection
// and fallback behavior.
//
// Keep this file exporting the same function signature for any legacy callers, but route through
// the new selector. This avoids hardwiring the region-blocked OpenAI Whisper endpoint.

import { transcribeWithConfiguredStt } from './stt';

export async function transcribeWithWhisper(params: {
  audioBuffer: ArrayBuffer;
  filename: string;
  mimeType?: string;
}): Promise<{ text: string; confidence?: number } | null> {
  const r = await transcribeWithConfiguredStt(params);
  if (!r.ok || !r.text) return null;
  return { text: r.text, confidence: r.confidence };
}

