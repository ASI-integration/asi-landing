export type SafeJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'empty' | 'invalid' };

/**
 * Read an incoming Web/Next.js Request body as JSON without throwing.
 *
 * Returns a tagged result so callers can distinguish "no body sent" (empty)
 * from "body sent but not valid JSON / not an object" (invalid) and reply
 * with a controlled 400 instead of bubbling up a parse error to the 500 path.
 *
 * The generic T defaults to `Record<string, unknown>` because every current
 * caller expects an object payload; primitive/array payloads are rejected
 * as `invalid` to keep destructuring at call sites safe.
 */
export async function readRequestJson<T extends object = Record<string, unknown>>(
  req: Request,
  options: { maxBytes?: number } = {},
): Promise<SafeJsonResult<T>> {
  let text: string;
  try {
    if (options.maxBytes === undefined) {
      text = await req.text();
    } else {
      const limit = options.maxBytes;
      if (!Number.isSafeInteger(limit) || limit < 1) return { ok: false, reason: 'invalid' };
      const reader = req.body?.getReader();
      if (!reader) return { ok: false, reason: 'empty' };
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            await reader.cancel();
            return { ok: false, reason: 'invalid' };
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!text.trim()) {
    return { ok: false, reason: 'empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, data: parsed as T };
}
