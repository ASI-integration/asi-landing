/**
 * Server-side client for scalable-fastapi-backend canonical Telegram pipeline.
 * No business rules: POST the raw Telegram update, receive a structured decision for the transport layer.
 */

export type BackendPipelineJson = {
  ok?: boolean;
  action_type?: string;
  current_state?: string | null;
  outbound_payload?: { text?: string } | null;
  outbound_send_allowed?: boolean;
  owner_notification_allowed?: boolean;
  reason?: string | null;
  delegated_resolution?: unknown;
  message_id?: string | null;
  session_id?: string | null;
  status?: string | null;
  caller_instructions?: string | null;
  error?: string;
};

export type BackendPipelinePostResult =
  | { ok: true; decision: BackendPipelineJson }
  | { ok: false; error: string };

function readBackendPipelineUrl(): string | null {
  const u = process.env.TELEGRAM_BACKEND_PIPELINE_URL;
  return u && u.trim().length > 0 ? u.trim() : null;
}

function backendFetchTimeoutMs(): number {
  const raw = process.env.TELEGRAM_BACKEND_PIPELINE_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 25_000;
}

/**
 * Returns whether the backend pipeline URL is configured (read at call time).
 */
export function isBackendTelegramPipelineConfigured(): boolean {
  return Boolean(readBackendPipelineUrl());
}

/**
 * POST full Telegram Update JSON to the backend pipeline endpoint.
 */
export async function postTelegramUpdateToBackendPipeline(
  update: Record<string, unknown>,
): Promise<BackendPipelinePostResult> {
  const url = readBackendPipelineUrl();
  if (!url) {
    return { ok: false, error: 'not_configured' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.TELEGRAM_BACKEND_PIPELINE_SECRET;
  if (secret && secret.trim().length > 0) {
    headers['X-Comm-Pipeline-Secret'] = secret.trim();
  }

  const ms = backendFetchTimeoutMs();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(update),
      signal: ac.signal,
    });
    const rawText = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'bad_body' };
    }
    const o = parsed as BackendPipelineJson;
    if (o.ok !== true) {
      return { ok: false, error: o.error ? String(o.error) : 'backend_ok_false' };
    }
    if (typeof o.action_type !== 'string' || !o.action_type) {
      return { ok: false, error: 'missing_action_type' };
    }
    return { ok: true, decision: o };
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'AbortError') {
      return { ok: false, error: `timeout_after_${ms}ms` };
    }
    return { ok: false, error: (e as Error).message ?? 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
