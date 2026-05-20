import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isCanonicalLocationReportPayload } from '@/lib/location/standalone-report';
import {
  buildGeneratedLocationReportDocument,
  type GeneratedLocationReportDocument,
} from '@/lib/location/location-report-engine';
import { buildFreeReportInterpretedContent } from '@/lib/location/free-report-content';
import { PremiumLocationReportPdf } from '@/components/location/premium-pdf/PremiumLocationReportPdf';
import { buildPremiumPdfViewModel } from '@/lib/location/premium-pdf-view-model';
import { canExposePaidLocationReport } from '@/lib/location/report-access';

export const dynamic = 'force-dynamic';

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MissingReportPrintFallback() {
  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Отчёт не найден</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">
          Ссылка устарела или отчёт был удалён. Запустите анализ заново и откройте новую ссылку на отчёт.
        </p>
        <Link
          href="/ru"
          className="mt-6 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Вернуться на главную
        </Link>
      </div>
    </main>
  );
}

function freeValues(doc: GeneratedLocationReportDocument) {
  const rawEvidenceBullets = doc.freeReport?.evidenceBullets ?? doc.freeSummary.keyFactorsRu;
  const score = doc.freeReport?.score ?? doc.freeSummary.publicScore;
  const content = buildFreeReportInterpretedContent({
    evidenceBullets: rawEvidenceBullets,
    score,
  });

  return {
    verdictSummary: doc.freeReport?.verdictSummary ?? doc.freeSummary.conclusionRu,
    score,
    evidenceBullets: content.demandSignalsRu,
    risksAndLimitsRu: content.risksAndLimitationsRu,
    recommendationRu: content.recommendationRu,
    content,
  };
}

export default async function RuLocationReportPrintPage(
  props: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await props.params;
  if (!reportId) notFound();

  const entity = await getStandaloneReportById(reportId);
  if (!entity || entity.locale !== 'ru' || !isCanonicalLocationReportPayload(entity.report)) {
    return <MissingReportPrintFallback />;
  }

  const doc = buildGeneratedLocationReportDocument(entity);

  if (doc.reportMode === 'paid') {
    if (!canExposePaidLocationReport(entity.report)) {
      return <MissingReportPrintFallback />;
    }
    const model = buildPremiumPdfViewModel(doc);
    return (
      <main className="premium-location-report-pdf-root min-h-screen bg-slate-100 print:bg-white print:p-0">
        <div className="print:hidden mx-auto max-w-5xl px-4 py-6 flex flex-wrap gap-3">
          <a
            href={`/api/location-report/${encodeURIComponent(reportId)}/pdf`}
            download={`location-report-${reportId}.pdf`}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Скачать PDF
          </a>
          <Link
            href={`/ru/location-report/${encodeURIComponent(reportId)}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Вернуться к отчёту
          </Link>
        </div>
        <PremiumLocationReportPdf model={model} />
      </main>
    );
  }

  const free = freeValues(doc);
  const keyStrength = free.evidenceBullets[0] ?? null;
  const keyRisk = free.risksAndLimitsRu[0] ?? null;

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-950 print:px-0 print:py-0">
      <div className="mx-auto max-w-3xl">
        <div className="print:hidden mb-6 flex flex-wrap gap-3">
          <Link
            href={`/ru/location-report/${encodeURIComponent(reportId)}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Вернуться к отчёту
          </Link>
        </div>

        <header className="border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Предпросмотр отчёта
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Отчёт по локации</h1>
          <p className="mt-3 text-base leading-relaxed"><strong>Адрес:</strong> {doc.inputAddress}</p>
          <p className="mt-1 text-sm text-slate-600">Расчёт: {formatDateRu(doc.calculatedAt)}</p>
          <p className="mt-1 text-xs text-slate-500">Номер отчёта: {doc.reportId}</p>
        </header>

        <section className="mt-7">
          <h2 className="text-xl font-bold">Общий вывод</h2>
          <p className="mt-2 text-base leading-relaxed">{free.verdictSummary}</p>
        </section>

        {keyStrength ? (
          <section className="mt-7">
            <h2 className="text-xl font-bold">Сильная сторона</h2>
            <p className="mt-2 text-base leading-relaxed">{keyStrength}</p>
          </section>
        ) : null}

        {keyRisk ? (
          <section className="mt-7">
            <h2 className="text-xl font-bold">Главный риск</h2>
            <p className="mt-2 text-base leading-relaxed">{keyRisk}</p>
          </section>
        ) : null}

        <section className="mt-7">
          <h2 className="text-xl font-bold">Полный отчёт</h2>
          <p className="mt-2 text-base leading-relaxed">{free.content.ctaTextRu}</p>
        </section>

      </div>
    </main>
  );
}
