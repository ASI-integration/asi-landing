import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRouteAccess } from '@/lib/booking-ops/route-access';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deliberately conservative *per Node process* admission cap. No user-IP
// headers are trusted. A multi-replica deployment must retain this guard AND
// add a shared/edge limit before enabling the privileged RPC.
const fixtureRateLimit = { windowStart: 0, used: 0 };
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 5;

const MAX_FIXTURE_BODY_BYTES = 2048;

// Bound bytes while reading. A Content-Length check alone is insufficient
// because clients can omit or misstate it. Do not buffer an unbounded body.
async function readBoundedFixtureBody(req: Request): Promise<string | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null &&
      (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > MAX_FIXTURE_BODY_BYTES)) {
    return null;
  }
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FIXTURE_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function consumeFixtureRateLimit(): number {
  // Monotonic time is immune to system clock changes.
  const now = performance.now();
  // Fail closed if the clock or the in-memory limiter state is invalid.
  if (!Number.isFinite(now) || !Number.isFinite(fixtureRateLimit.windowStart) ||
      !Number.isInteger(fixtureRateLimit.used) || fixtureRateLimit.used < 0 ||
      fixtureRateLimit.used > MAX_CALLS_PER_WINDOW || now < fixtureRateLimit.windowStart) {
    return 60;
  }
  if (fixtureRateLimit.windowStart === 0 ||
      now - fixtureRateLimit.windowStart >= WINDOW_MS) {
    fixtureRateLimit.windowStart = now;
    fixtureRateLimit.used = 0;
  }
  if (fixtureRateLimit.used >= MAX_CALLS_PER_WINDOW) {
    return Math.max(1, Math.ceil(
      (WINDOW_MS - (now - fixtureRateLimit.windowStart)) / 1000,
    ));
  }
  fixtureRateLimit.used += 1;
  return 0;
}

const forbiddenExternalEffects = () =>
  process.env.ASI_DEPLOYMENT_TIER !== 'staging' ||
  process.env.ASI_SYNTHETIC_NO_SEND !== 'YES' ||
  process.env.EMAIL_AUTO_SEND !== 'false' ||
  process.env.EMAIL_DRAFT_ONLY !== 'true' ||
  process.env.DRY_RUN_TELEGRAM_OUTBOUND !== 'true' ||
  process.env.ALLOW_REAL_TELEGRAM_SYNTHETIC !== 'false' ||
  process.env.YOOKASSA_ENABLED !== 'false';

export async function POST(req: Request) {
  // Only an administrator with an authenticated staging session may designate
  // the *single* record pinned by the staging owner as a synthetic fixture.
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  if (process.env.NODE_ENV !== 'production' ||
      forbiddenExternalEffects() ||
      process.env.OPS_ACCEPTANCE_FIXTURE_MARKING_ENABLED !== 'true' ||
      // Deployment is forbidden until the new 7-argument RPC exists and
      // its separate least-privilege caller has been independently verified.
      process.env.OPS_ACCEPTANCE_FIXTURE_RPC_V2_VERIFIED !== 'YES') {
    return NextResponse.json({ ok: false, message: 'fixture_marking_disabled' }, { status: 403 });
  }

  const pinnedId = process.env.OPS_ACCEPTANCE_FIXTURE_RECORD_ID;
  // Only canonical lowercase UUIDs are accepted from owner-controlled env.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!pinnedId || !uuidPattern.test(pinnedId)) {
    return NextResponse.json({ ok: false, message: 'fixture_record_not_pinned' }, { status: 403 });
  }
  // The two tenant values must be owner-pinned and match the single-row SQL
  // candidate. Never rely on identifiers sourced only from a request/session.
  const pinnedAccountId = process.env.OPS_ACCEPTANCE_FIXTURE_ACCOUNT_ID;
  const pinnedPropertyId = process.env.OPS_ACCEPTANCE_FIXTURE_PROPERTY_ID;
  const allowedRecordId = process.env.OPS_ACCEPTANCE_FIXTURE_ALLOWED_RECORD_ID;
  const allowedAccountId = process.env.OPS_ACCEPTANCE_FIXTURE_ALLOWED_ACCOUNT_ID;
  const allowedPropertyId = process.env.OPS_ACCEPTANCE_FIXTURE_ALLOWED_PROPERTY_ID;
  if (!pinnedAccountId || !pinnedPropertyId ||
      !allowedRecordId || !allowedAccountId || !allowedPropertyId ||
      !uuidPattern.test(pinnedAccountId) || !uuidPattern.test(pinnedPropertyId) ||
      !uuidPattern.test(allowedRecordId) || !uuidPattern.test(allowedAccountId) ||
      !uuidPattern.test(allowedPropertyId) ||
      allowedRecordId !== pinnedId ||
      allowedAccountId !== pinnedAccountId ||
      allowedPropertyId !== pinnedPropertyId ||
      new Set([pinnedId, pinnedAccountId, pinnedPropertyId]).size !== 3) {
    return NextResponse.json({ ok: false, message: 'fixture_tenant_not_pinned' }, { status: 403 });
  }
  const origin = req.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let expectedOrigin: string | null = null;
  try { if (appUrl) expectedOrigin = new URL(appUrl).origin; } catch { /* fail closed */ }
  // Additional privileged, non-cookie request proof for this manual owner action.
  // No token is issued by this endpoint; the operator supplies it separately.
  const secret = process.env.OPS_ACCEPTANCE_FIXTURE_CSRF_TOKEN;
  const supplied = req.headers.get('x-asi-fixture-csrf-token');
  if (!secret || !/^[A-Za-z0-9_-]{32,128}$/.test(secret) ||
      !supplied || !/^[A-Za-z0-9_-]{32,128}$/.test(supplied) ||
      !timingSafeEqual(createHash('sha256').update(supplied).digest(),
                       createHash('sha256').update(secret).digest())) {
    return NextResponse.json({ ok: false, message: 'fixture_request_proof_required' }, { status: 403 });
  }
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!origin || !expectedOrigin || origin !== expectedOrigin ||
      fetchSite !== 'same-origin' ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) {
    return NextResponse.json({ ok: false, message: 'origin_or_json_required' }, { status: 403 });
  }
  // Apply the rate limit BEFORE parsing attacker-controlled request payloads,
  // but only after authentication, owner pinning, and secret/origin proofs.
  // This prevents malformed privileged requests from bypassing the cap or
  // allowing unauthenticated requests to exhaust the owner operator's quota.
  const retryAfter = consumeFixtureRateLimit();
  if (retryAfter !== 0) {
    return NextResponse.json({ ok: false, message: 'too_many_requests' }, {
      status: 429, headers: { 'Retry-After': String(retryAfter) },
    });
  }
  const raw = await readBoundedFixtureBody(req);
  if (raw === null) {
    return NextResponse.json({ ok: false, message: 'payload_too_large' }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 }); }
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return NextResponse.json({ ok: false, message: 'invalid_payload' }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'acknowledgeSyntheticOnly,bookingOpsRecordId,confirm,noSend' ||
      fields.bookingOpsRecordId !== pinnedId ||
      fields.confirm !== true || fields.noSend !== true ||
      fields.acknowledgeSyntheticOnly !== true) {
    return NextResponse.json({ ok: false, message: 'explicit_pinned_fixture_confirmation_required' }, { status: 400 });
  }

  let access: Awaited<ReturnType<typeof requireBookingOpsRouteAccess>>;
  try {
    access = await requireBookingOpsRouteAccess(auth.session, pinnedId);
  } catch {
    return NextResponse.json({ ok: false, message: 'tenant_scope_unavailable' }, { status: 403 });
  }
  if (!access.actorId || !access.accountId || access.accountId === 'legacy' ||
      !uuidPattern.test(access.accountId) || !uuidPattern.test(access.propertyId || '') ||
      !uuidPattern.test(access.bookingId || '') ||
      new Set([access.accountId, access.propertyId, access.bookingId]).size !== 3 ||
      access.accountId !== pinnedAccountId ||
      access.propertyId !== pinnedPropertyId ||
      access.bookingId !== pinnedId) {
    return NextResponse.json({ ok: false, message: 'tenant_scope_unavailable' }, { status: 403 });
  }
  try {
    await requireBookingOpsRecordScope(pinnedId, {
      accountId: access.accountId, propertyId: access.propertyId,
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'tenant_scope_unavailable' }, { status: 403 });
  }
  try {
    const { data, error } = await supabase.rpc('asi_mark_acceptance_fixture', {
      p_record_id: pinnedId,
      p_account_id: access.accountId,
      p_property_id: access.propertyId,
      p_actor_id: access.actorId,
      p_allowed_record_id: allowedRecordId,
      p_allowed_account_id: allowedAccountId,
      p_allowed_property_id: allowedPropertyId,
    });
    if (error) throw new Error('atomic_fixture_marking_failed');
    if (data !== true) throw new Error('atomic_fixture_marking_not_confirmed');
    return NextResponse.json({
      ok: true, bookingOpsRecordId: pinnedId,
      acceptanceSafe: true, auditPersisted: true,
    });
  } catch {
    // Every database failure returns the same opaque response. Never classify
    // or reflect database/internal exception text back to the caller.
    return NextResponse.json({ ok: false, message: 'fixture_marking_failed' }, { status: 422 });
  }
}
