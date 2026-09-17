import { NextRequest, NextResponse } from 'next/server';
import { listGuestLifecycleVisibility } from '@/lib/communication/guest-lifecycle-runtime';
import { requireOperatorCommunicationScope } from '@/lib/communication/operator-access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;
  const rawLimit = Number(new URL(req.url).searchParams.get('limit') ?? 200);
  const result = await listGuestLifecycleVisibility({
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200,
    accountIds: [...scope.accountIds],
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, items: [] }, { status: 503 });
  return NextResponse.json({ ok: true, items: result.items });
}
