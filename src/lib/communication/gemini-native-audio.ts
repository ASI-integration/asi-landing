export type GeminiNativeAudioResult = {
  audio: ArrayBuffer | null;
  provider: 'gemini-native-audio';
  format: 'wav';
  errorType?: string;
};

const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const DEFAULT_VOICE = 'Aoede';
const DEFAULT_TIMEOUT_MS = 30_000;
const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const SPOKEN_TERMINAL_PUNCTUATION = /[.!?…](?:["'»”)\]]*)$/u;
const SPOKEN_TRAILING_CLOSERS = /["'»”)\]]+$/u;

const DEFAULT_SYSTEM_INSTRUCTION = [
  'You are the spoken voice of ASI, a guest concierge.',
  'Speak only the supplied guest-facing message. Do not add facts, greetings, explanations, or meta commentary.',
  'Use the same language as the supplied message and sound like a natural human speaker rather than reading technical text.',
  'Preserve all factual meaning exactly, but verbalize times, dates, numbers, abbreviations, and punctuation naturally for speech.',
  'Treat every supplied message as a complete utterance. For declarative sentences, finish the final phrase with a clear natural falling cadence. Do not use rising or continuation intonation unless the final sentence is actually a question.',
  'Pronounce the brand ASI as the compact English letter names “эй-эс-ай”, without artificial pauses between the letters.',
].join(' ');

function timeoutMs(): number {
  const raw = Number(process.env.GEMINI_NATIVE_AUDIO_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function apiKey(): string | null {
  const value = process.env.GEMINI_API_KEY?.trim();
  return value || null;
}

function modelName(): string {
  return process.env.GEMINI_NATIVE_AUDIO_MODEL?.trim() || DEFAULT_MODEL;
}

function voiceName(): string {
  return process.env.GEMINI_NATIVE_AUDIO_VOICE?.trim() || DEFAULT_VOICE;
}

function systemInstruction(): string {
  return process.env.GEMINI_NATIVE_AUDIO_INSTRUCTIONS?.trim() || DEFAULT_SYSTEM_INSTRUCTION;
}

/**
 * Make a speech-only copy look like a complete utterance to the native-audio
 * model. Visible Telegram text is never changed by this helper.
 */
export function ensureSpokenTerminalPunctuation(text: string): string {
  const value = String(text ?? '').trim();
  if (!value || SPOKEN_TERMINAL_PUNCTUATION.test(value)) return value;

  const closers = value.match(SPOKEN_TRAILING_CLOSERS)?.[0] ?? '';
  const stemWithPunctuation = closers ? value.slice(0, -closers.length) : value;
  const stem = stemWithPunctuation.replace(/[,:;]+$/u, '').trimEnd();
  return `${stem}.${closers}`;
}

export function isGeminiNativeAudioEnabled(): boolean {
  return process.env.GEMINI_NATIVE_AUDIO_ENABLED === '1' && Boolean(apiKey());
}

export function pcm16Mono24kToWav(pcm: Buffer): ArrayBuffer {
  const headerBytes = 44;
  const sampleRate = 24_000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const wav = Buffer.alloc(headerBytes + pcm.length);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, headerBytes);

  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
}

function messageText(data: unknown): Promise<string> {
  if (typeof data === 'string') return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data).toString('utf8'));
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return Promise.resolve(String(data ?? ''));
}

/**
 * Generate one spoken reply with Gemini Live Native Audio.
 *
 * This is intentionally isolated behind GEMINI_NATIVE_AUDIO_ENABLED=1.
 * Callers should keep a conventional TTS fallback so a provider/websocket
 * failure never blocks the already-sent text reply.
 */
export async function generateGeminiNativeSpeech(text: string): Promise<GeminiNativeAudioResult> {
  const input = ensureSpokenTerminalPunctuation(text);
  if (!input) {
    return { audio: null, provider: 'gemini-native-audio', format: 'wav', errorType: 'empty_text' };
  }

  const key = apiKey();
  if (!key) {
    return { audio: null, provider: 'gemini-native-audio', format: 'wav', errorType: 'missing_api_key' };
  }

  if (typeof WebSocket === 'undefined') {
    return { audio: null, provider: 'gemini-native-audio', format: 'wav', errorType: 'websocket_unavailable' };
  }

  return await new Promise<GeminiNativeAudioResult>((resolve) => {
    let socket: WebSocket | null = null;
    let settled = false;
    let inputSent = false;
    const chunks: Buffer[] = [];

    const finish = (audio: ArrayBuffer | null, errorType?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Best-effort connection cleanup only.
      }
      resolve({
        audio,
        provider: 'gemini-native-audio',
        format: 'wav',
        ...(errorType ? { errorType } : {}),
      });
    };

    const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs());

    try {
      socket = new WebSocket(`${LIVE_ENDPOINT}?key=${encodeURIComponent(key)}`);
    } catch {
      finish(null, 'connection_failed');
      return;
    }

    socket.onopen = () => {
      try {
        socket?.send(
          JSON.stringify({
            setup: {
              model: `models/${modelName()}`,
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voiceName() },
                },
              },
              systemInstruction: {
                parts: [{ text: systemInstruction() }],
              },
            },
          }),
        );
      } catch {
        finish(null, 'setup_send_failed');
      }
    };

    socket.onmessage = (event) => {
      void messageText(event.data).then((raw) => {
        if (settled) return;
        let response: {
          setupComplete?: unknown;
          serverContent?: {
            modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
            turnComplete?: boolean;
            interrupted?: boolean;
          };
        };
        try {
          response = JSON.parse(raw) as typeof response;
        } catch {
          return;
        }

        if (response.setupComplete && !inputSent) {
          inputSent = true;
          try {
            socket?.send(JSON.stringify({ realtimeInput: { text: input } }));
          } catch {
            finish(null, 'input_send_failed');
          }
          return;
        }

        const content = response.serverContent;
        for (const part of content?.modelTurn?.parts ?? []) {
          const encoded = part.inlineData?.data;
          if (!encoded) continue;
          try {
            chunks.push(Buffer.from(encoded, 'base64'));
          } catch {
            finish(null, 'invalid_audio_chunk');
            return;
          }
        }

        if (content?.interrupted) {
          finish(null, 'generation_interrupted');
          return;
        }

        if (content?.turnComplete) {
          const pcm = Buffer.concat(chunks);
          if (pcm.length < 4_800) {
            finish(null, 'empty_audio');
            return;
          }
          finish(pcm16Mono24kToWav(pcm));
        }
      });
    };

    socket.onerror = () => finish(null, 'network');
    socket.onclose = () => {
      if (!settled) finish(null, chunks.length > 0 ? 'connection_closed_early' : 'connection_closed');
    };
  });
}
