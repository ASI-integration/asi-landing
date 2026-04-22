import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

import { processWhatsAppVoiceWebhook } from '@/lib/whatsapp/voice-pipeline';
import type { WhatsAppWebhook } from '@/lib/whatsapp/types';
import { fetchWhatsAppMediaMeta, downloadWhatsAppMediaBytes } from '@/lib/whatsapp/media';
import { transcribeWhatsAppAudio } from '@/lib/whatsapp/stt';

export const runtime = 'nodejs';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !secret.trim()) return true; // optional hardening
  const sig = String(signatureHeader ?? '').trim();
  if (!sig.startsWith('sha256=')) return false;
  const expected = sig.slice('sha256='.length);
  const actual = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && challenge) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (expected && token === expected) {
      return new Response(challenge, { status: 200 });
    }
    console.warn('[wa:webhook] verify.fail', { has_expected: Boolean(expected), has_token: Boolean(token) });
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  let raw = '';
  try {
    raw = await req.text();
  } catch (err) {
    console.error('[wa:webhook] read_body.fail', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true, ignored: 'read_body_failed' }, { status: 200 });
  }

  const sigHeader =
    req.headers.get('x-hub-signature-256') ??
    req.headers.get('X-Hub-Signature-256');

  if (!verifySignature(raw, sigHeader)) {
    console.warn('[wa:webhook] 403 signature mismatch', { has_sig: Boolean(sigHeader) });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: WhatsAppWebhook | null = null;
  try {
    body = JSON.parse(raw) as WhatsAppWebhook;
  } catch (err) {
    console.error('[wa:webhook] invalid json', err instanceof Error ? err.message : String(err));
    // Returning 200 prevents retry storms on malformed payloads.
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  if (debugEnabled()) {
    console.log('[wa:webhook] recv', {
      object: body?.object ?? null,
      has_entry: Boolean(body?.entry?.length),
    });
  }

  try {
    const r = await processWhatsAppVoiceWebhook(body, {
      fetchMediaMeta: fetchWhatsAppMediaMeta,
      downloadMediaBytes: downloadWhatsAppMediaBytes,
      transcribe: transcribeWhatsAppAudio,
    });
    if (!r.ok) {
      // Still 200: WhatsApp retries; we rely on internal durability + dedupe.
      console.error('[wa:webhook] pipeline.fail', { error: r.error });
      return NextResponse.json({ ok: true, failed: r.error }, { status: 200 });
    }
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    console.error('[wa:webhook] pipeline.threw', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

