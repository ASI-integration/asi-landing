import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRouteAccess } from '@/lib/booking-ops/route-access';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      allowedPropertyId !== pinnedPropertyId) {
    return NextResponse.json({ ok: false, message: 'fixture_tenant_not_pinned' }, { status: 403 });
  }
  const origin = req.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let expectedOrigin: string | null = null;
  try { if (appUrl) expectedOrigin = new URL(appUrl).origin; } catch { /* fail closed */ }
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!origin || !expectedOrigin || origin !== expectedOrigin ||
      fetchSite !== 'same-origin' ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) {
    return NextResponse.json({ ok: false, message: 'origin_or_json_required' }, { status: 403 });
  }
  const raw = await req.text();
  if (raw.length > 2048) {
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
      access.accountId !== pinnedAccountId ||
      !access.propertyId || access.propertyId !== pinnedPropertyId ||
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
