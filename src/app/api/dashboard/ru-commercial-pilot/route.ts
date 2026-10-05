import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { supabase } from '@/lib/supabase';
import {
  beginSetup,
  completePilot,
  createSupabaseRuCommercialPilotStore,
  deriveReady,
  ensureApplication,
  getPilotLifecycle,
  startPilot,
  supabaseOwnsProperty,
  supabaseReadinessProbe,
  type RuCommercialPilotServiceDeps,
  type RuCommercialPilotState,
} from '@/lib/ru-commercial-pilot';
import { LEGAL_ACCEPTANCE_REQUIRED_CODE, hasCurrentRuLegalAcceptance } from '@/lib/ru-legal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deps(): RuCommercialPilotServiceDeps {
  return {
    store: createSupabaseRuCommercialPilotStore(),
    isReadinessSatisfied: supabaseReadinessProbe,
    ownsProperty: supabaseOwnsProperty,
  };
}

async function resolveCanonicalPilotAccount(propertyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('properties')
    .select('account_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return String(data.account_id);
}

function serializeState(state: RuCommercialPilotState | null) {
  if (!state) return null;
  return {
    accountId: state.accountId,
    propertyId: state.propertyId,
    status: state.status,
    timestamps: {
      setupStartedAt: state.timestamps.setupStartedAt?.toISOString() ?? null,
      readyAt: state.timestamps.readyAt?.toISOString() ?? null,
      pilotStartedAt: state.timestamps.pilotStartedAt?.toISOString() ?? null,
      pilotEndsAt: state.timestamps.pilotEndsAt?.toISOString() ?? null,
      pilotCompletedAt: state.timestamps.pilotCompletedAt?.toISOString() ?? null,
      reportReadyAt: state.timestamps.reportReadyAt?.toISOString() ?? null,
      continuationDecidedAt: state.timestamps.continuationDecidedAt?.toISOString() ?? null,
    },
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const propertyId = url.searchParams.get('propertyId')?.trim() ?? '';
  if (!propertyId) {
    return NextResponse.json(
      { ok: false, message: 'propertyId is required.' },
      { status: 400 },
    );
  }
  const accountId = await resolveCanonicalPilotAccount(propertyId);
  if (!accountId) return NextResponse.json({ ok: false, message: 'Property not found.' }, { status: 404 });

  const result = await getPilotLifecycle(deps(), accountId, propertyId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    state: serializeState(result.state),
    canManage: isOpsAdminEmail(auth.session.email),
  });
}

type Action =
  | 'ensure_application'
  | 'begin_setup'
  | 'derive_ready'
  | 'start_pilot'
  | 'complete_pilot';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON.' }, { status: 400 });
  }

  const action = String(body.action ?? '').trim() as Action;
  const propertyId = String(body.propertyId ?? body.property_id ?? '').trim();
  if (!propertyId) {
    return NextResponse.json(
      { ok: false, message: 'propertyId is required.' },
      { status: 400 },
    );
  }
  const accountId = await resolveCanonicalPilotAccount(propertyId);
  if (!accountId) return NextResponse.json({ ok: false, message: 'Property not found.' }, { status: 404 });
  const claimedAccountId = String(body.accountId ?? body.account_id ?? '').trim();
  if (claimedAccountId && claimedAccountId !== accountId) {
    return NextResponse.json({ ok: false, reason: 'account_property_mismatch' }, { status: 409 });
  }

  if (!(await hasCurrentRuLegalAcceptance(accountId))) {
    return NextResponse.json(
      { ok: false, code: LEGAL_ACCEPTANCE_REQUIRED_CODE },
      { status: 428 },
    );
  }

  const d = deps();
  let result;
  switch (action) {
    case 'ensure_application':
      result = await ensureApplication(d, accountId, propertyId);
      break;
    case 'begin_setup':
      result = await beginSetup(d, accountId, propertyId);
      break;
    case 'derive_ready':
      result = await deriveReady(d, accountId, propertyId);
      break;
    case 'start_pilot':
      result = await startPilot(d, accountId, propertyId);
      break;
    case 'complete_pilot':
      result = await completePilot(d, accountId, propertyId);
      break;
    default:
      return NextResponse.json({ ok: false, message: 'Unknown action.' }, { status: 400 });
  }

  if (!result.ok) {
    const status =
      result.reason === 'property_not_owned_by_account'
        ? 403
        : result.reason === 'lifecycle_not_found'
          ? 404
          : 409;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    state: serializeState(result.state),
  });
}
