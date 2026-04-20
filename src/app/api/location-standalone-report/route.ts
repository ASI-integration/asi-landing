import { NextRequest, NextResponse } from 'next/server';
import { createStandaloneReport } from '@/lib/location/standalone-report-store';
import { isLocationStandaloneReportV1, isLocationCommercialReport } from '@/lib/location/standalone-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function parseLocale(v: unknown): 'ru' | 'en' {
  return v === 'en' ? 'en' : 'ru';
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const locale = parseLocale(body?.locale);
  const report = body?.report;

  if (!isLocationStandaloneReportV1(report) && !isLocationCommercialReport(report)) {
    return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
  }

  try {
    const { reportId } = await createStandaloneReport({ locale, report: report as any });
    return NextResponse.json({ reportId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'create_failed', detail: msg }, { status: 502 });
  }
}
