/**
 * Post-deploy production checks for location report PDF (read-only HTTP).
 * Usage: node scripts/verify-location-report-pdf-production.mjs
 * Env: LOCATION_REPORT_VERIFY_BASE_URL overrides cases baseUrl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(__dirname, '..', 'tests', 'location-report-production-cases.json');

function loadCases() {
  const raw = fs.readFileSync(casesPath, 'utf8');
  return JSON.parse(raw);
}

function countPdfApiLinks(html) {
  const matches = html.match(/\/api\/location-report\/[^"'\\s]+\/pdf/g);
  return matches ? matches.length : 0;
}

function countDownloadPdfLabels(html) {
  const matches = html.match(/Скачать PDF/g);
  return matches ? matches.length : 0;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  return { res, text: await res.text() };
}

async function verifyReportPage(baseUrl, reportId, expectPdfLinks) {
  const url = `${baseUrl}/ru/location-report/${encodeURIComponent(reportId)}`;
  const { res, text } = await fetchText(url);
  if (!res.ok) {
    throw new Error(`report page ${reportId}: HTTP ${res.status}`);
  }
  const pdfLinks = countPdfApiLinks(text);
  if (pdfLinks !== expectPdfLinks) {
    throw new Error(
      `report page ${reportId}: expected ${expectPdfLinks} PDF API link(s), got ${pdfLinks}`,
    );
  }
  return { url, pdfLinks, downloadLabels: countDownloadPdfLabels(text) };
}

async function verifyPdfEndpoint(baseUrl, reportId) {
  const url = `${baseUrl}/api/location-report/${encodeURIComponent(reportId)}/pdf`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) {
    throw new Error(`pdf ${reportId}: HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/pdf')) {
    throw new Error(`pdf ${reportId}: expected application/pdf, got ${contentType}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 128) {
    throw new Error(`pdf ${reportId}: body too small (${buf.length} bytes)`);
  }
  if (buf.subarray(0, 4).toString('utf8') !== '%PDF') {
    throw new Error(`pdf ${reportId}: missing %PDF header`);
  }
  return { url, bytes: buf.length, header: buf.subarray(0, 8).toString('utf8') };
}

async function main() {
  const cases = loadCases();
  const baseUrl = (process.env.LOCATION_REPORT_VERIFY_BASE_URL ?? cases.baseUrl).replace(/\/$/, '');
  const freeId = cases.freePreviewReportId;
  const paidId = cases.paidFullReportId;

  const results = {};

  {
    const url = `${baseUrl}/ru/location-report/sample`;
    const { res, text } = await fetchText(url);
    if (!res.ok) throw new Error(`sample page: HTTP ${res.status}`);
    const pdfLinks = countPdfApiLinks(text);
    if (pdfLinks !== 0) throw new Error(`sample page: expected 0 PDF links, got ${pdfLinks}`);
    results.sample = { url, pdfLinks, downloadLabels: countDownloadPdfLabels(text) };
  }

  results.freePreview = await verifyReportPage(baseUrl, freeId, 0);
  results.paidFull = await verifyReportPage(baseUrl, paidId, 1);
  results.paidPdf = await verifyPdfEndpoint(baseUrl, paidId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        freePreviewReportId: freeId,
        paidFullReportId: paidId,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
