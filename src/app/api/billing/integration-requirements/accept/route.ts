/**
 * POST /api/billing/integration-requirements/accept
 * Internal/ops only (x-admin-secret) — records explicit acceptance of one
 * required integration for an account. Acceptance is never inferred from
 * incoming data; an operator/system with real evidence calls this.
 *
 * When this is the last required requirement, integration_ready_at is set
 * and the 14-day trial begins in the same operation — see
 * lib/billing/account-lifecycle.ts#acceptIntegrationRequirement. Server-side
 * state is authoritative; the response only reports what happened.
 *
 * Body: { accountId: string, type: IntegrationRequirementType, evidence?: object }
 */
import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import { acceptIntegrationRequirement } from '@/lib/billing/account-lifecycle';
import { INTEGRATION_REQUIREMENT_TYPES, type IntegrationRequirementType } from '@/lib/billing/integration-requirements';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  const parsed = await readRequestJson<{
    accountId?: string;
    type?: string;
    evidence?: Record<string, unknown>;
  }>(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { accountId, type, evidence } = parsed.data;
  if (!accountId || !type) {
    return NextResponse.json({ error: 'accountId and type are required' }, { status: 400 });
  }
  if (!INTEGRATION_REQUIREMENT_TYPES.includes(type as IntegrationRequirementType)) {
    return NextResponse.json({ error: 'invalid_type', allowed: INTEGRATION_REQUIREMENT_TYPES }, { status: 400 });
  }

  try {
    const result = await acceptIntegrationRequirement(accountId, type as IntegrationRequirementType, evidence ?? {});
    return NextResponse.json({
      ok: true,
      lifecycleStatus: result.state.status,
      integrationReady: result.integrationReady,
      trialStartedAt: result.state.timestamps.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: result.state.timestamps.trialEndsAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error('[billing/integration-requirements/accept]', err);
    const message = err instanceof Error ? err.message : 'accept_failed';
    return NextResponse.json({ error: 'accept_failed', message }, { status: 400 });
  }
}
