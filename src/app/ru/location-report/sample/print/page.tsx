import { PremiumLocationReportPdf } from '@/components/location/premium-pdf/PremiumLocationReportPdf';
import { buildGeneratedLocationReportDocument } from '@/lib/location/location-report-engine';
import { buildPremiumPdfViewModel } from '@/lib/location/premium-pdf-view-model';
import { sampleStrLocationStandaloneReportRu } from '@/lib/location/standalone-report';

export const dynamic = 'force-dynamic';

const SAMPLE_REPORT_ID = 'sample-location-report';

export default function RuLocationReportSamplePrintPage() {
  const doc = buildGeneratedLocationReportDocument({
    id: SAMPLE_REPORT_ID,
    locale: 'ru',
    address: sampleStrLocationStandaloneReportRu.address,
    report_version: 'v1',
    report: sampleStrLocationStandaloneReportRu,
    created_at: sampleStrLocationStandaloneReportRu.generated_at_iso,
  });
  const model = buildPremiumPdfViewModel(doc);

  return (
    <main className="premium-location-report-pdf-root min-h-screen bg-slate-100 print:bg-white print:p-0">
      <PremiumLocationReportPdf model={model} />
    </main>
  );
}
