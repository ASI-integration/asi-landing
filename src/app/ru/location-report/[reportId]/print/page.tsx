import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStandaloneReportById } from '@/lib/location/standalone-report-store';
import { isCanonicalLocationReportPayload } from '@/lib/location/standalone-report';
import {
  buildGeneratedLocationReportDocument,
  type GeneratedLocationReportDocument,
} from '@/lib/location/location-report-engine';

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
  return {
    verdictSummary: doc.freeReport?.verdictSummary ?? doc.freeSummary.conclusionRu,
    score: doc.freeReport?.score ?? doc.freeSummary.publicScore,
    evidenceBullets: doc.freeReport?.evidenceBullets ?? doc.freeSummary.keyFactorsRu,
    risksAndLimitsRu: doc.freeReport?.risksAndLimitsRu ?? doc.freeSummary.risksAndLimitsRu,
    recommendationRu: doc.freeReport?.recommendationRu ?? doc.freeSummary.recommendationRu,
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
  const free = freeValues(doc);

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-950 print:px-0 print:py-0">
      <div className="mx-auto max-w-3xl">
        <div className="print:hidden mb-6 flex flex-wrap gap-3">
          <a
            href={`/api/location-report/${encodeURIComponent(reportId)}/pdf`}
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

        <header className="border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {doc.reportMode === 'free' ? 'Бесплатный отчёт' : 'Подробный отчёт'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Отчёт по локации</h1>
          <p className="mt-3 text-base leading-relaxed"><strong>Адрес:</strong> {doc.inputAddress}</p>
          <p className="mt-1 text-sm text-slate-600">Расчёт: {formatDateRu(doc.calculatedAt)}</p>
          <p className="mt-1 text-xs text-slate-500">Номер отчёта: {doc.reportId}</p>
        </header>

        <section className="mt-7">
          <h2 className="text-xl font-bold">Вывод</h2>
          <p className="mt-2 text-base leading-relaxed">{free.verdictSummary}</p>
          {free.score != null ? (
            <p className="mt-3 inline-flex rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold">
              Оценка: {free.score} / 100
            </p>
          ) : null}
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-bold">Ключевые факторы</h2>
          <ul className="mt-3 space-y-2">
            {free.evidenceBullets.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-bold">Риски и ограничения</h2>
          <ul className="mt-3 space-y-2">
            {free.risksAndLimitsRu.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-bold">Рекомендации</h2>
          <p className="mt-2 text-base leading-relaxed">{free.recommendationRu}</p>
        </section>

        {doc.reportMode === 'paid' && doc.paidSections?.length ? (
          <section className="mt-7">
            <h2 className="text-xl font-bold">Разделы подробного отчёта</h2>
            <ul className="mt-3 space-y-3">
              {doc.paidSections.map(section => (
                <li key={section.id}>
                  <strong>{section.titleRu}</strong>
                  <br />
                  <span className="text-slate-700">{section.summaryRu}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
