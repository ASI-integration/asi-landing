/**
 * /api/operator/leads — server-side proxy to ASI-automation-core
 *
 * asi-landing is a thin UI layer. This route:
 *   1. Validates the operator's iron-session (UI auth guard)
 *   2. Forwards the request to ASI-automation-core with server-to-server auth
 *   3. Returns the response verbatim (adapter note: contracts are identical)
 *
 * ASI-automation-core is the single source of truth for ops_tasks / leads.
 * No direct Supabase access here.
 *
 * GET  /api/operator/leads[?status=open|in_progress|resolved|canceled]
 *   → { ok: true, leads: Lead[] }
 *
 * PATCH /api/operator/leads
 *   Body: { leadId, status?, internalNote?, followUpNeeded? }
 *   → { ok: true, lead: Lead }
 *   Proxy forwards to core: PATCH /api/operator/leads/[leadId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { fetchLeads, patchLead } from '@/lib/core-api';

export const dynamic = 'force-dynamic';

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireSession() {
  const session = await getSession();
  if (!session.userId) return null;
  return session;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;

  try {
    const result = await fetchLeads(status);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] GET proxy error: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  try {
    const result = await patchLead({
      leadId,
      ...(status        !== undefined && { status:        String(status)        }),
      ...(internalNote  !== undefined && { internalNote:  String(internalNote)  }),
      ...(followUpNeeded !== undefined && { followUpNeeded: String(followUpNeeded) }),
    });

    console.log(
      `[operator/leads] PATCH leadId=${leadId} status=${status ?? 'unchanged'} by user=${session.userId}`,
    );

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] PATCH proxy error leadId=${leadId}: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
