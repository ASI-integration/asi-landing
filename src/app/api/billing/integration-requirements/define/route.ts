/**
 * POST /api/billing/integration-requirements/define
 * Internal/ops only (x-admin-secret) — declares which integrations are
 * required for an account before onboarding can complete. Not customer-
 * facing; no client-submitted lifecycle state is ever trusted.
 *
 * Body: { accountId: string, type: IntegrationRequirementType, label: string, required?: boolean }
 */
import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import { defineIntegrationRequirement } from '@/lib/billing/account-lifecycle';
import { INTEGRATION_REQUIREMENT_TYPES, type IntegrationRequirementType } from '@/lib/billing/integration-requirements';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  const parsed = await readRequestJson<{
    accountId?: string;
    type?: string;
    label?: string;
    required?: boolean;
  }>(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { accountId, type, label, required } = parsed.data;
  if (!accountId || !type || !label) {
    return NextResponse.json({ error: 'accountId, type, and label are required' }, { status: 400 });
  }
  if (!INTEGRATION_REQUIREMENT_TYPES.includes(type as IntegrationRequirementType)) {
    return NextResponse.json({ error: 'invalid_type', allowed: INTEGRATION_REQUIREMENT_TYPES }, { status: 400 });
  }

  try {
    await defineIntegrationRequirement(accountId, type as IntegrationRequirementType, label, required ?? true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[billing/integration-requirements/define]', err);
    return NextResponse.json({ error: 'define_failed' }, { status: 500 });
  }
}
