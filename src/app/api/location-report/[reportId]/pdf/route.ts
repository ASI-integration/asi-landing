import { NextRequest, NextResponse } from 'next/server';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import {
  isCanonicalLocationReportPayload,
  isLocationStandaloneReportV1,
} from '@/lib/location/standalone-report';
import { canExposePaidLocationReport } from '@/lib/location/report-access';
import {
  clientMessageForLocationReportPdfError,
  locationReportPdfFilename,
  logLocationReportPdfFailure,
  renderLocationReportPdfFromPrintRoute,
} from '@/lib/location/location-report-print-pdf';
import {
  clearLocationReportPdfRenderEntity,
  primeLocationReportPdfRenderEntity,
} from '@/lib/location/location-report-pdf-render-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await ctx.params;
  if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 });

  try {
    const entity = await getStandaloneReportById(reportId);
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (!isCanonicalLocationReportPayload(entity.report)) {
      return NextResponse.json({ error: 'invalid_persisted_report' }, { status: 502 });
    }
    if (isLocationStandaloneReportV1(entity.report) && entity.report.reportMode === 'free') {
      return NextResponse.json({ error: 'preview_only' }, { status: 403 });
    }
    if (!canExposePaidLocationReport(entity.report)) {
      return NextResponse.json({ error: 'locked' }, { status: 403 });
    }

    primeLocationReportPdfRenderEntity(entity);
    let pdf: Buffer;
    try {
      pdf = await renderLocationReportPdfFromPrintRoute(reportId);
    } finally {
      clearLocationReportPdfRenderEntity(reportId);
    }
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${locationReportPdfFilename(reportId)}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    logLocationReportPdfFailure(reportId, err);
    return NextResponse.json(
      { error: 'pdf_failed', message: clientMessageForLocationReportPdfError(err) },
      { status: 502 },
    );
  }
}
