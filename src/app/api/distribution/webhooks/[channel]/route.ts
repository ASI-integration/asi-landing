import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type WebhookReservationPayload = {
  connection_id?: string;
  external_reservation_id?: string;
  status?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  check_in?: string; // YYYY-MM-DD
  check_out?: string; // YYYY-MM-DD
  currency?: string;
  total_amount?: number | string;
  raw?: unknown;
};

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params;

  // Phase 1: accept webhook events and persist safely; provider verification is Phase 2.
  const rawBody = await req.text();
  const payload = safeJsonParse<WebhookReservationPayload>(rawBody) ?? {};

  const connectionId =
    typeof payload.connection_id === 'string' && payload.connection_id.length > 0 ? payload.connection_id : null;

  if (!connectionId) {
    return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  }

  // Load connection + account boundary (do not allow a broken channel to affect others)
  const { data: conn, error: connErr } = await supabase
    .from('dist_property_channel_connections')
    .select('id, account_id, status, channel_id')
    .eq('id', connectionId)
    .maybeSingle();
  if (connErr) throw connErr;
  if (!conn) return NextResponse.json({ error: 'Unknown connection' }, { status: 404 });

  // Validate channel code matches the connection's catalog (best-effort; don't hard fail on catalog mismatch in Phase 1)
  const { data: ch, error: chErr } = await supabase
    .from('dist_distribution_channels')
    .select('id, code')
    .eq('id', conn.channel_id)
    .maybeSingle();
  if (chErr) throw chErr;
  if (ch?.code && ch.code !== channel) {
    // Record as an inbound sync event for auditability; still accept to avoid losing provider retries.
    await supabase.from('dist_sync_events').insert({
      account_id: conn.account_id,
      connection_id: conn.id,
      direction: 'inbound',
      kind: 'reservations_ingest',
      request_json: { warning: 'channel_code_mismatch', expected: ch.code, got: channel },
      response_json: {},
      status: 'skipped',
      error_message: 'channel_code_mismatch',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }

  if (conn.status === 'disabled') {
    // Persist audit event but do not mutate reservations when disabled.
    await supabase.from('dist_sync_events').insert({
      account_id: conn.account_id,
      connection_id: conn.id,
      direction: 'inbound',
      kind: 'reservations_ingest',
      request_json: { disabled: true, body_sha256: sha256(rawBody), body: payload },
      response_json: { accepted: true, skipped: true },
      status: 'skipped',
      error_message: 'connection_disabled',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ accepted: true, skipped: true });
  }

  const providerEventId =
    (req.headers.get('idempotency-key') ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('x-event-id') ||
      req.headers.get('x-request-id') ||
      null) ?? null;

  const idempotencyKey =
    typeof providerEventId === 'string' && providerEventId.trim().length > 0
      ? providerEventId.trim()
      : `sha256:${sha256(rawBody)}`;

  const payloadHash = sha256(rawBody);

  // Idempotency protection (per connection)
  const existingIdem = await supabase
    .from('dist_idempotency_keys')
    .select('id, payload_hash, first_seen_at')
    .eq('scope', 'webhook')
    .eq('connection_id', conn.id)
    .eq('key', idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (existingIdem.error) throw existingIdem.error;

  const now = new Date().toISOString();

  if (existingIdem.data) {
    if (existingIdem.data.payload_hash && existingIdem.data.payload_hash !== payloadHash) {
      // Same idempotency key with different payload is dangerous. Log and skip mutation.
      await supabase.from('dist_sync_events').insert({
        account_id: conn.account_id,
        connection_id: conn.id,
        direction: 'inbound',
        kind: 'reservations_ingest',
        request_json: { channel, idempotency_key: idempotencyKey, body_sha256: payloadHash, body: payload },
        response_json: { accepted: true, skipped: true, reason: 'idempotency_payload_mismatch' },
        status: 'error',
        error_message: 'idempotency_payload_mismatch',
        started_at: now,
        finished_at: now,
        created_at: now,
      });
      return NextResponse.json({ accepted: true, skipped: true, reason: 'idempotency_payload_mismatch' });
    }

    await supabase
      .from('dist_idempotency_keys')
      .update({ last_seen_at: now })
      .eq('id', existingIdem.data.id);

    await supabase.from('dist_sync_events').insert({
      account_id: conn.account_id,
      connection_id: conn.id,
      direction: 'inbound',
      kind: 'reservations_ingest',
      request_json: { channel, idempotency_key: idempotencyKey, body_sha256: payloadHash },
      response_json: { accepted: true, deduped: true },
      status: 'ok',
      started_at: now,
      finished_at: now,
      created_at: now,
    });

    return NextResponse.json({ accepted: true, deduped: true });
  }

  const { error: idemInsErr } = await supabase.from('dist_idempotency_keys').insert({
    account_id: conn.account_id,
    connection_id: conn.id,
    scope: 'webhook',
    key: idempotencyKey,
    payload_hash: payloadHash,
    first_seen_at: now,
    last_seen_at: now,
  });
  if (idemInsErr) throw idemInsErr;

  const externalReservationId =
    typeof payload.external_reservation_id === 'string' && payload.external_reservation_id.length > 0
      ? payload.external_reservation_id
      : null;

  const auditReq = {
    channel,
    idempotency_key: idempotencyKey,
    body_sha256: payloadHash,
    body: payload,
  };

  if (!externalReservationId) {
    await supabase.from('dist_sync_events').insert({
      account_id: conn.account_id,
      connection_id: conn.id,
      direction: 'inbound',
      kind: 'reservations_ingest',
      request_json: auditReq,
      response_json: { accepted: true, warning: 'missing_external_reservation_id' },
      status: 'ok',
      started_at: now,
      finished_at: now,
      created_at: now,
    });
    return NextResponse.json({ accepted: true, warning: 'missing_external_reservation_id' });
  }

  // Upsert reservation by (connection_id, external_reservation_id)
  const status =
    payload.status === 'cancelled' || payload.status === 'confirmed' || payload.status === 'modified'
      ? payload.status
      : 'new';

  const { data: reservation, error: resErr } = await supabase
    .from('dist_channel_reservations')
    .upsert(
      {
        account_id: conn.account_id,
        connection_id: conn.id,
        external_reservation_id: externalReservationId,
        status,
        guest_name: typeof payload.guest_name === 'string' ? payload.guest_name : null,
        guest_email: typeof payload.guest_email === 'string' ? payload.guest_email : null,
        guest_phone: typeof payload.guest_phone === 'string' ? payload.guest_phone : null,
        check_in: typeof payload.check_in === 'string' ? payload.check_in : null,
        check_out: typeof payload.check_out === 'string' ? payload.check_out : null,
        currency: typeof payload.currency === 'string' ? payload.currency : null,
        total_amount:
          typeof payload.total_amount === 'number' || typeof payload.total_amount === 'string'
            ? payload.total_amount
            : null,
        raw_json: (payload.raw && typeof payload.raw === 'object' ? (payload.raw as any) : payload) as any,
        updated_at: now,
      },
      { onConflict: 'connection_id,external_reservation_id' },
    )
    .select(
      'id, external_reservation_id, status, check_in, check_out, guest_name, guest_email, guest_phone, currency, total_amount, created_at, updated_at',
    )
    .single();
  if (resErr) throw resErr;

  await supabase.from('dist_sync_events').insert({
    account_id: conn.account_id,
    connection_id: conn.id,
    direction: 'inbound',
    kind: 'reservations_ingest',
    request_json: auditReq,
    response_json: { accepted: true, reservation_id: reservation.id },
    status: 'ok',
    started_at: now,
    finished_at: now,
    created_at: now,
  });

  await supabase
    .from('dist_property_channel_connections')
    .update({ last_attempt_at: now, last_error: null, updated_at: now })
    .eq('id', conn.id);

  return NextResponse.json({ accepted: true, reservation });
}

