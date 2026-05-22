import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LOCATION_REPORT_PRODUCT_PATH,
  LOCATION_REPORT_SAMPLE_PDF_PATH,
} from '@/lib/location/report-state';
import { YOOKASSA_PENDING_REVIEW_MESSAGE } from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'Пример отчёта по посуточной аренде — ASI',
  description:
    'Демонстрационный пример полного отчёта ASI по потенциалу локации для посуточной аренды.',
  robots: { index: false, follow: false },
};

export default function RuLocationReportSamplePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-slate-800/70 bg-slate-900/30 p-6 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Пример полного отчёта</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Демонстрационный пример услуги</h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-200 sm:text-base">
            Демонстрационный пример полного отчёта. Подготовлен для показа формата услуги. Не является
            инвестиционной рекомендацией.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={LOCATION_REPORT_SAMPLE_PDF_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Открыть PDF-версию
            </a>
            <a
              href={`${LOCATION_REPORT_SAMPLE_PDF_PATH}?download=1`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
            >
              Скачать PDF
            </a>
            <Link
              href={LOCATION_REPORT_PRODUCT_PATH}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:text-white"
            >
              Перейти к заказу отчёта
            </Link>
          </div>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-5">
            <h2 className="text-lg font-semibold">Что получает платный пользователь</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
              <li>Веб-версию полного отчёта с разделами по локации, спросу и рискам.</li>
              <li>PDF-версию отчёта для скачивания и отправки партнёрам.</li>
              <li>Структурированные разделы: вывод, метрики, рекомендации, ограничения.</li>
            </ul>
          </article>
          <article className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-5">
            <h2 className="text-lg font-semibold">Доставка и доступ</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
              <li>Готовность веб-отчёта сразу после расчёта и оплаты.</li>
              <li>PDF доступен по ссылке в отчёте и в личном кабинете.</li>
              <li>Копия ссылки и подтверждение приходят на email клиента.</li>
            </ul>
          </article>
        </section>

        <p className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
          {YOOKASSA_PENDING_REVIEW_MESSAGE}
        </p>
      </div>
    </main>
  );
}
