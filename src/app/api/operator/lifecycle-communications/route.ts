import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listGuestLifecycleVisibility } from '@/lib/communication/guest-lifecycle-runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rawLimit = Number(new URL(req.url).searchParams.get('limit') ?? 200);
  const result = await listGuestLifecycleVisibility({
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, items: [] }, { status: 503 });
  return NextResponse.json({ ok: true, items: result.items });
}
