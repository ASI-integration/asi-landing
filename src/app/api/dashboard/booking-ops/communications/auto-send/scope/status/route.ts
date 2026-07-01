import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getAutoSendOperationalStatus } from '@/lib/booking-ops/communication-auto-send-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const status = await getAutoSendOperationalStatus();
  return NextResponse.json({ ok: true, ...status });
}
