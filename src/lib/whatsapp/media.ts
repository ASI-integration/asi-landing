import type { WhatsAppMediaMeta } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20MB safety cap

function timeoutMs(): number {
  const raw = process.env.WHATSAPP_HTTP_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function maxBytes(): number {
  const raw = process.env.WHATSAPP_MEDIA_MAX_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function token(): string | null {
  const t = process.env.WHATSAPP_ACCESS_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

function graphBase(): string {
  return (process.env.WHATSAPP_GRAPH_BASE_URL ?? 'https://graph.facebook.com').replace(/\/+$/, '');
}

function graphVersion(): string {
  return String(process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0').trim();
}

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

export async function fetchWhatsAppMediaMeta(mediaId: string): Promise<WhatsAppMediaMeta | null> {
  const accessToken = token();
  if (!accessToken) {
    console.warn('[wa:media] missing_env.WHATSAPP_ACCESS_TOKEN');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  const url = `${graphBase()}/${graphVersion()}/${encodeURIComponent(mediaId)}?fields=url,mime_type,sha256,file_size`;
  if (debugEnabled()) console.log('[wa:media] meta.start', { media_id: mediaId });

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[wa:media] meta.fail_http', { status: res.status, body: body.slice(0, 200) });
      return null;
    }
    const data = (await res.json()) as Partial<WhatsAppMediaMeta>;
    if (!data?.url || !data?.id) {
      console.error('[wa:media] meta.fail_shape');
      return null;
    }
    if (debugEnabled()) console.log('[wa:media] meta.ok', { bytes: data.file_size ?? null, mime: data.mime_type ?? null });
    return {
      id: String(data.id),
      url: String(data.url),
      mime_type: data.mime_type ? String(data.mime_type) : undefined,
      sha256: data.sha256 ? String(data.sha256) : undefined,
      file_size: typeof data.file_size === 'number' ? data.file_size : undefined,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.error('[wa:media] meta.fail_network', { abort: isAbort, message: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadWhatsAppMediaBytes(meta: WhatsAppMediaMeta): Promise<ArrayBuffer | null> {
  const accessToken = token();
  if (!accessToken) {
    console.warn('[wa:media] missing_env.WHATSAPP_ACCESS_TOKEN');
    return null;
  }

  const size = meta.file_size;
  if (typeof size === 'number' && size > maxBytes()) {
    console.error('[wa:media] download.reject_too_large', { bytes: size, max: maxBytes() });
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  if (debugEnabled()) console.log('[wa:media] download.start', { media_id: meta.id, has_size: typeof size === 'number' });

  try {
    const res = await fetch(meta.url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[wa:media] download.fail_http', { status: res.status, body: body.slice(0, 200) });
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes()) {
      console.error('[wa:media] download.fail_too_large_after', { bytes: buf.byteLength, max: maxBytes() });
      return null;
    }
    if (debugEnabled()) console.log('[wa:media] download.ok', { bytes: buf.byteLength });
    return buf;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.error('[wa:media] download.fail_network', { abort: isAbort, message: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

