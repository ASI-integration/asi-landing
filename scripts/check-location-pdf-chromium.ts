/**
 * VPS / deploy preflight: confirm Chromium can launch for location report PDFs.
 * Usage: npx tsx scripts/check-location-pdf-chromium.ts
 * Exit 0 = OK, 1 = Chromium missing or launch failed.
 */
import {
  checkLocationReportPdfChromium,
  resolveLocationReportAppBaseUrl,
} from '../src/lib/location/location-report-print-pdf';

async function main() {
  const baseUrl = resolveLocationReportAppBaseUrl();
  const result = await checkLocationReportPdfChromium();
  const summary = {
    ok: result.ok,
    executablePath: result.executablePath ?? null,
    pdfBaseUrl: baseUrl,
    reason: result.reason ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, reason: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
