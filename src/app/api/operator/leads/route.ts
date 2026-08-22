/**
 * /api/operator/leads — server-side proxy to ASI-automation-core with tenant isolation
 *
 * asi-landing is a thin UI layer. This route:
 *   1. Validates the operator's iron-session and resolves their persisted
 *      `account_members` accounts (via operator-access.ts — the same scope
 *      resolution used by the operator escalation-reviews API).
 *   2. Forwards the request to ASI-automation-core with server-to-server auth.
 *   3. Enforces tenant ownership LOCALLY, before returning (GET) or mutating
 *      (PATCH) — never assumes ASI-automation-core does this for us.
 *
 * ASI-automation-core is the single source of truth for ops_tasks / leads,
 * but its current contract has no account/tenant concept: leads are global,
 * keyed only by `property_id`. There is no `GET /leads/[leadId]` endpoint
 * and no `account_id` filter or ownership check on PATCH.
 *
 * Required upstream contract to remove the extra GET round-trip below and
 * to get true fail-closed enforcement at the source of truth: ASI-automation-core
 * would need (a) a single-lead fetch endpoint, and (b) to accept and enforce
 * an authenticated account_id scope itself. Neither exists today, so this
 * route enforces ownership itself using asi-landing's own canonical
 * `properties.account_id` mapping (trusted local evidence — see
 * resolvePropertyAccountId in operator-access.ts) applied to the
 * `property_id` every lead already carries in the existing contract.
 *
 * GET  /api/operator/leads[?status=open|in_progress|resolved|canceled]
 *   → { ok: true, leads: Lead[] }  — filtered to the operator's accounts only
 *
 * PATCH /api/operator/leads
 *   Body: { leadId, status?, internalNote?, followUpNeeded? }
 *   → { ok: true, lead: Lead }     — ownership verified before any upstream mutation
 *   → 403 if the lead's property does not resolve to one of the operator's accounts
 *   → 404 if the lead is not found in the upstream list
 */

import { NextRequest, NextResponse } from 'next/server';
import type { CoreLead } from '@/lib/core-api';
import { fetchLeads, patchLead } from '@/lib/core-api';
import {
  batchResolvePropertyAccountIds,
  requireOperatorCommunicationScope,
} from '@/lib/communication/operator-access';

export const dynamic = 'force-dynamic';

/**
 * Resolve which of the operator's accounts (if any) owns each lead, using
 * only the trusted local `properties.account_id` mapping. A lead whose
 * property cannot be resolved (missing, ambiguous, or lookup failure) is
 * excluded — never guessed into scope.
 */
async function partitionLeadsByAccountScope(
  leads: CoreLead[],
  accountIds: ReadonlySet<string>,
): Promise<{ ok: true; owned: CoreLead[] } | { ok: false }> {
  const propertyIds = leads.map((lead) => lead.property_id).filter((id): id is string => Boolean(id));
  const propertyAccounts = await batchResolvePropertyAccountIds(propertyIds);
  if (!propertyAccounts) return { ok: false };
  const owned = leads.filter((lead) => {
    const accountId = lead.property_id ? propertyAccounts.get(lead.property_id) : undefined;
    return Boolean(accountId && accountIds.has(accountId));
  });
  return { ok: true, owned };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;

  try {
    const result = await fetchLeads(status);
    const partitioned = await partitionLeadsByAccountScope(result.leads ?? [], scope.accountIds);
    if (!partitioned.ok) {
      // Tenant resolution failed — fail closed, never fall back to the
      // unfiltered global list.
      return NextResponse.json({ ok: false, error: 'tenant_resolution_failed' }, { status: 503 });
    }
    return NextResponse.json({ ok: true, leads: partitioned.owned });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] GET proxy error: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId, status, internalNote, followUpNeeded } = body;

  if (typeof leadId !== 'string' || !leadId) {
    return NextResponse.json({ error: 'leadId required' }, { status: 400 });
  }

  // Verify ownership BEFORE any upstream mutation. ASI-automation-core has
  // no single-lead-fetch or ownership-check endpoint, so this fetches the
  // (unfiltered) lead list and resolves the target lead's account locally —
  // zero upstream mutation happens unless this resolves to an account the
  // operator is a member of.
  let leads: CoreLead[];
  try {
    const result = await fetchLeads();
    leads = result.leads ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] PATCH ownership-check fetch error leadId=${leadId}: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const target = leads.find((lead) => lead.leadId === leadId);
  if (!target) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const partitioned = await partitionLeadsByAccountScope([target], scope.accountIds);
  if (!partitioned.ok) {
    return NextResponse.json({ ok: false, error: 'tenant_resolution_failed' }, { status: 503 });
  }
  if (partitioned.owned.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await patchLead({
      leadId,
      ...(status        !== undefined && { status:        String(status)        }),
      ...(internalNote  !== undefined && { internalNote:  String(internalNote)  }),
      ...(followUpNeeded !== undefined && { followUpNeeded: String(followUpNeeded) }),
    });

    console.log(
      `[operator/leads] PATCH leadId=${leadId} status=${status ?? 'unchanged'} by user=${scope.session.userId}`,
    );

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] PATCH proxy error leadId=${leadId}: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
