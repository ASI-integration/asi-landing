/**
 * Admin endpoint: trigger one pass of the stay-flow auto-advancement runner.
 *
 * POST /api/admin/run-stay-flow
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Returns:
 *   200 { ok: true, result: StayFlowRunnerResult }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { runStayFlowAdvancement } from '@/lib/ops/stay-flow-runner';

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runStayFlowAdvancement();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
