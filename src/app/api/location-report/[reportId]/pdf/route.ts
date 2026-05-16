import { NextRequest, NextResponse } from 'next/server';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isCanonicalLocationReportPayload } from '@/lib/location/standalone-report';
import {
  buildGeneratedLocationReportDocument,
} from '@/lib/location/location-report-engine';
import { buildLocationReportPdf } from '@/lib/location/location-report-pdf';

export const dynamic = 'force-dynamic';

function reportPdfFilename(reportId: string): string {
  const safeReportId = reportId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'report';
  return `asi-location-report-${safeReportId}.pdf`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await ctx.params;
  if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 });

  try {
    const entity = await getStandaloneReportById(reportId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (!isCanonicalLocationReportPayload(entity.report)) {
      return NextResponse.json({ error: 'invalid_persisted_report' }, { status: 502 });
    }

    const doc = buildGeneratedLocationReportDocument(entity);
    const pdf = await buildLocationReportPdf(doc);
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${reportPdfFilename(reportId)}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'pdf_failed', detail: msg }, { status: 502 });
  }
}
