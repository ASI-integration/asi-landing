/**
 * Admin endpoint: read ops tasks.
 *
 * GET /api/admin/ops-tasks
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Query params (all optional — at least one recommended):
 *   property_id=...
 *   reservation_id=...
 *   status=open|in_progress|resolved|canceled
 *
 * Returns:
 *   200 { ok: true, tasks: OpsTask[] }
 *   400 { error: "Provide at least one filter" }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { getOpsTasks, OpsTaskStatus } from '@/lib/ops/tasks';

const VALID_STATUSES = new Set<string>(Object.values(OpsTaskStatus));

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const property_id    = searchParams.get('property_id')    ?? undefined;
  const reservation_id = searchParams.get('reservation_id') ?? undefined;
  const statusParam    = searchParams.get('status')         ?? undefined;

  if (!property_id && !reservation_id && !statusParam) {
    return NextResponse.json(
      { error: 'Provide at least one filter: property_id, reservation_id, or status' },
      { status: 400 },
    );
  }

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` },
      { status: 400 },
    );
  }

  const result = await getOpsTasks({
    property_id,
    reservation_id,
    task_status: statusParam as OpsTaskStatus | undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tasks: result.tasks });
}
