import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EmailInboundPayload } from './channels/email';
import { processEmailInbound, type EmailInboundProcessingResult } from './email-inbound-processor';

const DEFAULT_RESEND_API_BASE_URL = 'https://api.resend.com';
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type ResendEmailReceivedEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    message_id?: string;
    attachments?: Array<{
      id?: string;
      filename?: string;
      content_type?: string;
      content_disposition?: string;
      content_id?: string | null;
      size?: number;
    }>;
  };
};

type ResendReceivedEmail = {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject?: string;
  message_id?: string;
  created_at?: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, unknown> | Array<{ name?: string; value?: string }>;
  attachments?: Array<{
    id?: string;
    filename?: string;
    content_type?: string;
    content_disposition?: string;
    content_id?: string | null;
    size?: number;
  }>;
};

export type ResendInboundResult =
  | { ok: true; ignored: true; reason: 'unsupported_event' }
  | {
      ok: true;
      ignored: false;
      emailId: string;
      processing: EmailInboundProcessingResult;
    };

export class ResendInboundError extends Error {
  constructor(
    public readonly code:
      | 'webhook_not_configured'
      | 'invalid_webhook'
      | 'stale_webhook'
      | 'invalid_payload'
      | 'provider_not_configured'
      | 'provider_fetch_failed',
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ResendInboundError';
  }
}

export async function processResendInboundWebhook(params: {
  rawBody: string;
  headers: Headers | Record<string, string | null | undefined>;
  nowMs?: number;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<ResendInboundResult> {
  const env = params.env ?? process.env;
  verifyResendWebhook({
    rawBody: params.rawBody,
    headers: params.headers,
    nowMs: params.nowMs,
    env,
  });

  let event: ResendEmailReceivedEvent;
  try {
    event = JSON.parse(params.rawBody) as ResendEmailReceivedEvent;
  } catch {
    throw new ResendInboundError('invalid_payload', 'Resend webhook body is not valid JSON', 400);
  }

  if (event.type !== 'email.received') {
    return { ok: true, ignored: true, reason: 'unsupported_event' };
  }

  const emailId = String(event.data?.email_id ?? '').trim();
  if (!emailId) {
    throw new ResendInboundError('invalid_payload', 'Resend email.received event has no email_id', 400);
  }

  const apiKey = String(env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new ResendInboundError('provider_not_configured', 'RESEND_API_KEY is not configured', 503);
  }

  const received = await fetchReceivedEmail({
    emailId,
    apiKey,
    apiBaseUrl: String(env.RESEND_API_BASE_URL ?? DEFAULT_RESEND_API_BASE_URL),
    fetchFn: params.fetchFn ?? fetch,
  });

  const processing = await processEmailInbound({
    payload: normalizeResendReceivedEmail(received, event),
  });

  return { ok: true, ignored: false, emailId, processing };
}

export function verifyResendWebhook(params: {
  rawBody: string;
  headers: Headers | Record<string, string | null | undefined>;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = params.env ?? process.env;
  const secret = String(env.RESEND_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    throw new ResendInboundError('webhook_not_configured', 'RESEND_WEBHOOK_SECRET is not configured', 503);
  }

  const id = readHeader(params.headers, 'svix-id');
  const timestampRaw = readHeader(params.headers, 'svix-timestamp');
  const signatureHeader = readHeader(params.headers, 'svix-signature');
  if (!id || !timestampRaw || !signatureHeader) {
    throw new ResendInboundError('invalid_webhook', 'Missing Resend/Svix signature headers', 401);
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    throw new ResendInboundError('invalid_webhook', 'Invalid Resend webhook timestamp', 401);
  }

  const tolerance = positiveInt(env.RESEND_WEBHOOK_TOLERANCE_SECONDS, DEFAULT_WEBHOOK_TOLERANCE_SECONDS);
  const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new ResendInboundError('stale_webhook', 'Resend webhook timestamp is outside the replay window', 401);
  }

  const keyText = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyText, 'base64');
  } catch {
    throw new ResendInboundError('webhook_not_configured', 'RESEND_WEBHOOK_SECRET is malformed', 503);
  }
  if (key.length === 0) {
    throw new ResendInboundError('webhook_not_configured', 'RESEND_WEBHOOK_SECRET is malformed', 503);
  }

  const signedContent = `${id}.${timestampRaw}.${params.rawBody}`;
  const expected = createHmac('sha256', key).update(signedContent).digest();
  const supplied = signatureHeader
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const comma = entry.indexOf(',');
      return comma >= 0 ? { version: entry.slice(0, comma), value: entry.slice(comma + 1) } : null;
    })
    .filter((entry): entry is { version: string; value: string } => Boolean(entry && entry.version === 'v1' && entry.value));

  const valid = supplied.some((candidate) => {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(candidate.value, 'base64');
    } catch {
      return false;
    }
    return decoded.length === expected.length && timingSafeEqual(decoded, expected);
  });

  if (!valid) {
    throw new ResendInboundError('invalid_webhook', 'Resend webhook signature verification failed', 401);
  }
}

async function fetchReceivedEmail(params: {
  emailId: string;
  apiKey: string;
  apiBaseUrl: string;
  fetchFn: typeof fetch;
}): Promise<ResendReceivedEmail> {
  const base = params.apiBaseUrl.trim().replace(/\/$/, '') || DEFAULT_RESEND_API_BASE_URL;
  const url = `${base}/emails/receiving/${encodeURIComponent(params.emailId)}`;
  let response: Response;
  try {
    response = await params.fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    throw new ResendInboundError(
      'provider_fetch_failed',
      `Failed to retrieve received email: ${(error as Error).name || 'network'}`,
      503,
    );
  }

  if (!response.ok) {
    throw new ResendInboundError(
      'provider_fetch_failed',
      `Resend Receiving API returned HTTP ${response.status}`,
      response.status >= 500 || response.status === 429 ? 503 : 502,
    );
  }

  const body = (await response.json().catch(() => null)) as ResendReceivedEmail | null;
  if (!body || typeof body !== 'object') {
    throw new ResendInboundError('provider_fetch_failed', 'Resend Receiving API returned invalid JSON', 502);
  }
  return body;
}

export function normalizeResendReceivedEmail(
  email: ResendReceivedEmail,
  event?: ResendEmailReceivedEvent,
): EmailInboundPayload {
  const eventData = event?.data;
  const from = String(email.from ?? eventData?.from ?? '').trim();
  const to = arrayOfStrings(email.to ?? eventData?.to);
  const cc = arrayOfStrings(email.cc ?? eventData?.cc);
  const replyTo = arrayOfStrings(email.reply_to);
  const subject = String(email.subject ?? eventData?.subject ?? '').trim();
  const messageId = String(email.message_id ?? eventData?.message_id ?? email.id ?? eventData?.email_id ?? '').trim();
  const createdAt = String(email.created_at ?? eventData?.created_at ?? event?.created_at ?? '').trim();
  const attachments = email.attachments ?? eventData?.attachments ?? [];

  return {
    from,
    to,
    cc,
    replyTo,
    subject,
    text: typeof email.text === 'string' ? email.text : undefined,
    html: typeof email.html === 'string' ? email.html : undefined,
    messageId,
    date: createdAt || undefined,
    headers: normalizeHeaders(email.headers),
    attachments: attachments.map((item) => ({
      filename: item.filename,
      contentType: item.content_type,
      size: item.size,
      contentId: item.content_id ?? undefined,
    })),
  };
}

function normalizeHeaders(
  headers: ResendReceivedEmail['headers'],
): Record<string, string | string[] | undefined> | undefined {
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const item of headers) {
      const name = String(item.name ?? '').trim();
      const value = String(item.value ?? '').trim();
      if (name && value) out[name] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map((entry) => String(entry));
    else if (value != null) out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function readHeader(
  headers: Headers | Record<string, string | null | undefined>,
  name: string,
): string {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return String(headers.get(name) ?? '').trim();
  }
  const record = headers as Record<string, string | null | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return String((key ? record[key] : undefined) ?? '').trim();
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
