export function parseJsonString<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/** Read a fetch Response body as JSON without throwing on empty or invalid payloads. */
export async function readResponseJson<T>(res: Response, fallback: T): Promise<T> {
  try {
    const text = await res.text();
    return parseJsonString(text, fallback);
  } catch {
    return fallback;
  }
}
