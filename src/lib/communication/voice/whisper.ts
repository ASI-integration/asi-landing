const WHISPER_TIMEOUT_MS_DEFAULT = 30_000;

function getWhisperTimeoutMs(): number {
  const raw = process.env.WHISPER_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : WHISPER_TIMEOUT_MS_DEFAULT;
}

function getWhisperApiKey(): string | null {
  const k = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : null;
}

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

export async function transcribeWithWhisper(params: {
  audioBuffer: ArrayBuffer;
  filename: string;
}): Promise<{ text: string; confidence?: number } | null> {
  if (process.env.VOICE_TRANSCRIPTION_DISABLED === '1') {
    if (debugEnabled()) console.info('[voice:whisper] transcription.disabled');
    return null;
  }

  const apiKey = getWhisperApiKey();
  if (!apiKey) {
    console.warn('[voice:whisper] missing_env.OPENAI_API_KEY_or_LLM_API_KEY');
    return null;
  }

  const timeoutMs = getWhisperTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (debugEnabled()) {
    console.log('[voice:whisper] start', { filename: params.filename, timeout_ms: timeoutMs, bytes: params.audioBuffer.byteLength });
  }

  try {
    const blob = new Blob([params.audioBuffer]);
    const form = new FormData();
    form.append('file', blob, params.filename);
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[voice:whisper] fail_http', { status: res.status, body: body.slice(0, 200) });
      return null;
    }

    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    if (!text) {
      console.warn('[voice:whisper] fail_empty');
      return null;
    }
    if (debugEnabled()) console.log('[voice:whisper] ok', { chars: text.length });
    // OpenAI Whisper doesn't expose confidence in this endpoint today; keep optional for future providers.
    return { text };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('[voice:whisper] fail_timeout', { timeout_ms: timeoutMs });
    } else {
      console.error('[voice:whisper] fail_network', (err as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

