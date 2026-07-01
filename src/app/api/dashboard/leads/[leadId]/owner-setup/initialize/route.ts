import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { initializeOwnerSetupFromLead } from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { leadId: string } };

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let metadata: Record<string, unknown> | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && body.metadata && typeof body.metadata === 'object') {
      metadata = body.metadata as Record<string, unknown>;
    }
  } catch {
    metadata = undefined;
  }

  try {
    const result = await initializeOwnerSetupFromLead(context.params.leadId, metadata);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось инициализировать настройку.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
