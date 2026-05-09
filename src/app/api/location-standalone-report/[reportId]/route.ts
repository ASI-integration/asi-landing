import { NextRequest, NextResponse } from 'next/server';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isCanonicalLocationReportPayload } from '@/lib/location/standalone-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await ctx.params;
  if (!reportId || typeof reportId !== 'string') {
    return NextResponse.json({ error: 'reportId required' }, { status: 400 });
  }

  try {
    const entity = await getStandaloneReportById(reportId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (!isCanonicalLocationReportPayload(entity.report)) {
      return NextResponse.json({ error: 'invalid_persisted_report' }, { status: 502 });
    }
    return NextResponse.json({ report: entity.report, locale: entity.locale, created_at: entity.created_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'fetch_failed', detail: msg }, { status: 502 });
  }
}

