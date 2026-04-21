export function redactSecrets(obj: unknown): Record<string, unknown> {
  const input = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (
      key.includes('token') ||
      key.includes('secret') ||
      key.includes('password') ||
      key.includes('api_key') ||
      key.includes('apikey') ||
      key.includes('private_key')
    ) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = v;
  }
  return out;
}

