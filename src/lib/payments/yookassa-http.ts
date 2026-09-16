/**
 * Injectable YooKassa HTTP transport (server-only).
 * Tests mock this module — never call the real API from CI.
 */
export type YooKassaHttpRequest = {
  method: 'GET' | 'POST';
  path: string;
  shopId: string;
  secretKey: string;
  idempotenceKey?: string;
  body?: unknown;
};

export type YooKassaHttpResponse = {
  ok: boolean;
  status: number;
  json: unknown;
};

export type YooKassaHttp = (request: YooKassaHttpRequest) => Promise<YooKassaHttpResponse>;

const API_BASE = 'https://api.yookassa.ru/v3';

export const defaultYooKassaHttp: YooKassaHttp = async (request) => {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${request.shopId}:${request.secretKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  if (request.idempotenceKey) {
    headers['Idempotence-Key'] = request.idempotenceKey;
  }

  const response = await fetch(`${API_BASE}${request.path}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { ok: response.ok, status: response.status, json };
};

let activeHttp: YooKassaHttp = defaultYooKassaHttp;

export function getYooKassaHttp(): YooKassaHttp {
  return activeHttp;
}

/** Test-only override */
export function setYooKassaHttpForTests(http: YooKassaHttp | null): void {
  activeHttp = http ?? defaultYooKassaHttp;
}
