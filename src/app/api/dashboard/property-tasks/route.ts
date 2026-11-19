import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { requirePropertyPermission } from '@/lib/booking-ops/property-role-access';
import { shadowPostgrestRequest } from '@/lib/booking-ops/shadow-postgrest-jwt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function trustedIdentity(request: Request) {
  if (!isSessionSecretConfigured()) throw new Error('unauthorized');
  const session = await getSession();
  if (!session.userId || !UUID.test(session.userId)) throw new Error('unauthorized');
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') ?? '';
  const propertyId = url.searchParams.get('propertyId') ?? '';
  if (![accountId, propertyId].every((v) => UUID.test(v))) throw new Error('invalid_scope');
  // Never accept role from cookies, request parameters or the browser.
  const appRole = await requirePropertyPermission(
    { userId: session.userId, accountId, propertyId }, 'perform_task',
  );
  return { userId: session.userId, accountId, propertyId, appRole };
}

/** Requests are authorized by a verified JWT inside PostgREST, not service_role. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const identity = await trustedIdentity(request);
    const params = new URLSearchParams({
      select: 'id,property_id,task_type,work_kind,task_status,title,description,due_at,assigned_to,resolved_at',
      property_id: 'eq.' + identity.propertyId,
      order: 'created_at.desc',
      limit: '50',
    });
    const response = await shadowPostgrestRequest(identity, '/rest/v1/ops_tasks?' + params);
    if (!response.ok) return NextResponse.json({ ok: false, error: 'shadow_task_lookup_failed' }, { status: 503 });
    return NextResponse.json({ ok: true, tasks: await response.json() });
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    return NextResponse.json({ ok: false, error: reason === 'unauthorized' ? reason : 'access_denied' },
      { status: reason === 'unauthorized' ? 401 : 403 });
  }
}

/** The caller cannot select new status/assignment; only complete an assigned task. */
export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const identity = await trustedIdentity(request);
    const taskId = new URL(request.url).searchParams.get('taskId') ?? '';
    if (!UUID.test(taskId)) return NextResponse.json({ ok: false, error: 'invalid_task_id' }, { status: 400 });
    const params = new URLSearchParams({
      id: 'eq.' + taskId, property_id: 'eq.' + identity.propertyId,
      select: 'id,task_status,resolved_at',
    });
    const now = new Date().toISOString();
    const response = await shadowPostgrestRequest(identity, '/rest/v1/ops_tasks?' + params, {
      method: 'PATCH',
      body: JSON.stringify({ task_status: 'resolved', resolved_at: now, updated_at: now }),
    });
    if (!response.ok) return NextResponse.json({ ok: false, error: 'shadow_task_update_denied' }, { status: 403 });
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) {
      return NextResponse.json({ ok: false, error: 'task_not_found_or_not_assigned' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, task: rows[0] });
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    return NextResponse.json({ ok: false, error: reason === 'unauthorized' ? reason : 'access_denied' },
      { status: reason === 'unauthorized' ? 401 : 403 });
  }
}
