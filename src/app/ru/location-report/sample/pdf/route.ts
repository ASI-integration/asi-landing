import { NextRequest, NextResponse } from 'next/server';
import {
  clientMessageForLocationReportPdfError,
  locationReportSamplePdfFilename,
  logLocationReportPdfFailure,
  renderLocationReportSamplePdfFromPrintRoute,
} from '@/lib/location/location-report-print-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const pdf = await renderLocationReportSamplePdfFromPrintRoute();
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    const filename = locationReportSamplePdfFilename();
    const disposition = download ? 'attachment' : 'inline';

    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${disposition}; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    logLocationReportPdfFailure('sample', err);
    return NextResponse.json(
      { error: 'pdf_failed', message: clientMessageForLocationReportPdfError(err) },
      { status: 502 },
    );
  }
}
