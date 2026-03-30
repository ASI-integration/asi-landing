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
 *   Body: { task_id, task_status?, operator_note?, follow_up_at? }
 *   → { ok: true, lead: Lead }
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

  const { task_id, task_status, operator_note, follow_up_at } = body;

  if (typeof task_id !== 'string' || !task_id) {
    return NextResponse.json({ error: 'task_id required' }, { status: 400 });
  }

  try {
    const result = await patchLead({
      task_id,
      ...(task_status  !== undefined && { task_status:   String(task_status)  }),
      ...(operator_note !== undefined && { operator_note: String(operator_note) }),
      ...(follow_up_at  !== undefined && { follow_up_at:  String(follow_up_at)  }),
    });

    console.log(
      `[operator/leads] PATCH task_id=${task_id} status=${task_status ?? 'unchanged'} by user=${session.userId}`,
    );

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[operator/leads] PATCH proxy error task_id=${task_id}: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
