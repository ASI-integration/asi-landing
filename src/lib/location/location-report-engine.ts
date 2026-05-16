import type { PersistedStandaloneReportEntity } from './standalone-report-store';
import {
  buildLocationReportStructureViewModel,
  paidLocationReportStructureSections,
} from './location-report-structure';
import {
  normalizeReportAddress,
  type LocationReportDataFreshness,
} from './report-result-metadata';
import type {
  LocationCommercialReport,
  LocationFreeReportSummarySnapshot,
  LocationGeneratedReportPdfStatus,
  LocationGeneratedReportStatus,
  LocationPaidReportSectionSnapshot,
  LocationStandaloneReport,
  PersistableLocationReport,
} from './standalone-report';

export type GeneratedLocationReportMode = 'free' | 'paid';

export type GeneratedLocationReportDocument = {
  reportId: string;
  reportMode: GeneratedLocationReportMode;
  inputAddress: string;
  normalizedAddress: string;
  calculatedAt: string;
  status: LocationGeneratedReportStatus;
  dataFreshness: LocationReportDataFreshness | null;
  freeSummary: LocationFreeReportSummarySnapshot;
  paidSections?: LocationPaidReportSectionSnapshot[];
  pdfUrl?: string;
  pdfStatus: LocationGeneratedReportPdfStatus;
  persistedReport: PersistableLocationReport;
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function standaloneSummary(report: LocationStandaloneReport): LocationFreeReportSummarySnapshot {
  const summary = report.sections.find(s => s.id === 'summary');
  const verdict = summary?.id === 'summary' ? summary.verdict : 'Отчёт по локации готов.';
  const factors = summary?.id === 'summary' ? summary.drivers.slice(0, 5) : [];
  return {
    conclusionRu: report.freeSummary?.conclusionRu ?? verdict,
    publicScore: report.freeSummary?.publicScore ?? null,
    keyFactorsRu: report.freeSummary?.keyFactorsRu?.length ? report.freeSummary.keyFactorsRu : factors,
    risksAndLimitsRu: report.freeSummary?.risksAndLimitsRu?.length
      ? report.freeSummary.risksAndLimitsRu
      : ['Проверьте конкуренцию, состояние объекта, ограничения дома и фактический спрос перед решением.'],
    recommendationRu: report.freeSummary?.recommendationRu ?? 'Используйте общий вывод как первый фильтр перед подробным разбором.',
  };
}

function commercialSummary(report: LocationCommercialReport): LocationFreeReportSummarySnapshot {
  return {
    conclusionRu: report.recommendation,
    publicScore: null,
    keyFactorsRu: [
      report.flow.flowConclusion,
      ...report.formatFit.entries
        .slice(0, 3)
        .map(entry => `${entry.formatLabelRu}: ${entry.explanationRu}`),
    ].filter(Boolean).slice(0, 5),
    risksAndLimitsRu: report.barriers.length
      ? report.barriers.slice(0, 4)
      : ['Перед запуском проверьте фактический поток, конкурентов и ограничения помещения вручную.'],
    recommendationRu: report.recommendation,
  };
}

function reportMode(report: PersistableLocationReport): GeneratedLocationReportMode {
  if (report.version === 'v1') return report.reportMode ?? 'paid';
  return 'paid';
}

export function buildGeneratedLocationReportDocument(
  entity: PersistedStandaloneReportEntity,
): GeneratedLocationReportDocument {
  const report = entity.report;
  const mode = reportMode(report);
  const meta = report.version === 'v1' ? report.metadata : undefined;
  const inputAddress =
    cleanString(report.version === 'v1' ? report.inputAddress : undefined) ??
    cleanString(meta?.inputAddress) ??
    report.address;
  const normalizedAddress =
    cleanString(report.version === 'v1' ? report.normalizedAddress : undefined) ??
    cleanString(meta?.normalizedAddress) ??
    normalizeReportAddress(inputAddress);
  const calculatedAt =
    cleanString(report.version === 'v1' ? report.calculatedAt : undefined) ??
    cleanString(meta?.calculatedAt) ??
    report.generated_at_iso;
  const dataFreshness =
    report.version === 'v1'
      ? (report.dataFreshness ?? meta?.dataFreshness ?? null)
      : null;
  const freeSummary = report.version === 'v1'
    ? standaloneSummary(report)
    : commercialSummary(report);
  const paidSections =
    mode === 'paid'
      ? report.version === 'v1' && report.paidSections?.length
        ? report.paidSections
        : paidLocationReportStructureSections.map(({ id, titleRu, summaryRu }) => ({
          id,
          titleRu,
          summaryRu,
        }))
      : undefined;

  return {
    reportId: entity.id,
    reportMode: mode,
    inputAddress,
    normalizedAddress,
    calculatedAt,
    status: report.version === 'v1' ? (report.status ?? 'ready') : 'ready',
    dataFreshness,
    freeSummary,
    ...(paidSections ? { paidSections } : {}),
    pdfUrl: report.version === 'v1'
      ? (report.pdfUrl ?? `/api/location-report/${encodeURIComponent(entity.id)}/pdf`)
      : `/api/location-report/${encodeURIComponent(entity.id)}/pdf`,
    pdfStatus: report.version === 'v1' ? (report.pdfStatus ?? 'ready') : 'ready',
    persistedReport: report,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function listHtml(items: string[]): string {
  return items.length
    ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>Нет данных для этого раздела.</p>';
}

export function buildLocationReportPrintHtml(doc: GeneratedLocationReportDocument): string {
  const structure = doc.reportMode === 'free'
    ? buildLocationReportStructureViewModel('free')
    : buildLocationReportStructureViewModel('paid');
  const calculatedAt = new Date(doc.calculatedAt);
  const calculatedAtRu = Number.isFinite(calculatedAt.getTime())
    ? calculatedAt.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : doc.calculatedAt;
  const paidSectionHtml = doc.reportMode === 'paid' && doc.paidSections?.length
    ? `
      <section>
        <h2>Разделы подробного отчёта</h2>
        <ul>
          ${doc.paidSections.map(section => (
            `<li><strong>${escapeHtml(section.titleRu)}</strong><br>${escapeHtml(section.summaryRu)}</li>`
          )).join('')}
        </ul>
      </section>
    `
    : '';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(structure.titleRu)} — ${escapeHtml(doc.inputAddress)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 40px; line-height: 1.55; }
    main { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 30px; margin: 0 0 10px; }
    h2 { font-size: 20px; margin: 28px 0 10px; border-top: 1px solid #e2e8f0; padding-top: 18px; }
    p { margin: 8px 0; }
    .meta { color: #475569; font-size: 14px; }
    .score { display: inline-block; margin-top: 8px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; }
    li { margin: 6px 0; }
    @media print { body { margin: 18mm; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(structure.titleRu)}</h1>
    <p class="meta">Номер отчёта: ${escapeHtml(doc.reportId)}</p>
    <p><strong>Адрес:</strong> ${escapeHtml(doc.inputAddress)}</p>
    <p><strong>Дата расчёта:</strong> ${escapeHtml(calculatedAtRu)}</p>
    ${doc.dataFreshness ? `<p class="meta">${escapeHtml(doc.dataFreshness.summaryRu)}</p>` : ''}

    <section>
      <h2>Вывод</h2>
      <p>${escapeHtml(doc.freeSummary.conclusionRu)}</p>
      ${doc.freeSummary.publicScore == null ? '' : `<p class="score">Score: ${escapeHtml(doc.freeSummary.publicScore)} / 100</p>`}
    </section>

    <section>
      <h2>Ключевые факторы</h2>
      ${listHtml(doc.freeSummary.keyFactorsRu)}
    </section>

    <section>
      <h2>Риски и ограничения</h2>
      ${listHtml(doc.freeSummary.risksAndLimitsRu)}
    </section>

    <section>
      <h2>Рекомендации</h2>
      <p>${escapeHtml(doc.freeSummary.recommendationRu)}</p>
    </section>

    ${paidSectionHtml}
  </main>
</body>
</html>`;
}
