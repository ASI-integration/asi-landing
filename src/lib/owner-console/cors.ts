const ALLOWED_ORIGINS = new Set([
  'https://guestautopilot.com',
  'https://www.guestautopilot.com',
  'https://app.guestautopilot.com',
  'https://asi-global.ru',
  'https://www.asi-global.ru',
  'https://app.asi-global.ru',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

/** Echo a marketing origin only when it is one of the two public sites or local dev. */
export function ownerDemoCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Vary', 'Origin');
  headers.set('X-Demo-Sandbox', '1');
  headers.set('X-LLM-Tokens', '0');
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}
