export type SafeJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'empty' | 'invalid' };

export type BoundedSafeJsonResult<T> =
  | SafeJsonResult<T>
  | { ok: false; reason: 'too_large' };

function parseJsonObject<T extends object>(text: string): SafeJsonResult<T> {
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

function cancelStream(stream: ReadableStream<Uint8Array> | null): void {
  if (!stream) return;
  try {
    void stream.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best effort; the request is still rejected.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best effort; the request is still rejected.
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new Error('Request aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error('Request aborted')));
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

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
  req: Request
): Promise<SafeJsonResult<T>> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  return parseJsonObject<T>(text);
}

/**
 * Read an object JSON body while retaining at most maxBytes of actual stream data.
 * A valid oversized Content-Length is an early rejection hint, never the byte-count authority.
 */
export async function readBoundedRequestJson<T extends object = Record<string, unknown>>(
  req: Request,
  maxBytes: number,
): Promise<BoundedSafeJsonResult<T>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: 'invalid' };
  }

  const claimedLength = req.headers.get('content-length')?.trim();
  if (claimedLength && /^\d+$/.test(claimedLength)) {
    try {
      if (BigInt(claimedLength) > BigInt(maxBytes)) {
        cancelStream(req.body);
        return { ok: false, reason: 'too_large' };
      }
    } catch {
      // Malformed/unsupported values are ignored and the actual stream remains authoritative.
    }
  }

  if (!req.body) return { ok: false, reason: 'empty' };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = req.body.getReader();
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, req.signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        cancelReader(reader);
        return { ok: false, reason: 'invalid' };
      }
      if (value.byteLength > maxBytes - totalBytes) {
        cancelReader(reader);
        return { ok: false, reason: 'too_large' };
      }
      if (value.byteLength > 0) chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch {
    cancelReader(reader);
    return { ok: false, reason: 'invalid' };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A pending read may retain the lock briefly after cancellation.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  return parseJsonObject<T>(text);
}
