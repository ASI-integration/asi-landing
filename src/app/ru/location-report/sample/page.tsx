import type { Metadata } from 'next';
import {
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPrimaryCta,
  BrandSecondaryCta,
} from '@/components/brand';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuLocationProductNav } from '@/components/ru/RuLocationProductNav';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
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

const ANALYSIS_HREF = '/ru/location-analysis?mode=residential#location-check';

export default function RuLocationReportSamplePage() {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main className="flex-1 px-5 sm:px-8 py-12 sm:py-20">
        <div className="max-w-6xl mx-auto">
          <RuLocationProductNav currentPath="/ru/location-report/sample" />

          <div className="max-w-3xl border border-asi-border bg-asi-paper p-8 sm:p-10">
            <div className="flex items-center gap-3">
              <BrandLogoMark size={28} />
              <span className="font-serif text-lg text-asi-navy">ASI</span>
            </div>
            <p className="mt-6 text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              Пример полного отчёта
            </p>
            <BrandHeadline as="h1" className="mt-4 text-3xl sm:text-4xl">
              Демонстрационный пример услуги
            </BrandHeadline>
            <BrandGoldRule className="mt-6 mb-6" />
            <p className="text-asi-navy/70 leading-relaxed">
              Демонстрационный пример полного отчёта. Подготовлен для показа формата услуги. Не
              является инвестиционной рекомендацией. Доход не гарантируется.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <BrandPrimaryCta href={LOCATION_REPORT_SAMPLE_PDF_PATH}>
                Открыть PDF-версию
              </BrandPrimaryCta>
              <BrandSecondaryCta href={`${LOCATION_REPORT_SAMPLE_PDF_PATH}?download=1`}>
                Скачать PDF
              </BrandSecondaryCta>
              <BrandSecondaryCta href={ANALYSIS_HREF}>Оценить объект по адресу</BrandSecondaryCta>
            </div>
          </div>

          <section className="mt-10 grid gap-4 sm:grid-cols-2 max-w-3xl">
            <article className="border border-asi-border bg-asi-paper p-6">
              <h2 className="font-serif text-xl text-asi-navy">Что получает платный пользователь</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-asi-navy/70">
                <li>Веб-версию полного отчёта с разделами по локации, спросу и рискам.</li>
                <li>PDF-версию отчёта для скачивания и отправки партнёрам.</li>
                <li>Структурированные разделы: вывод, метрики, рекомендации, ограничения.</li>
              </ul>
            </article>
            <article className="border border-asi-border bg-asi-paper p-6">
              <h2 className="font-serif text-xl text-asi-navy">Доставка и доступ</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-asi-navy/70">
                <li>Готовность веб-отчёта сразу после расчёта и оплаты.</li>
                <li>PDF доступен по ссылке в отчёте и в личном кабинете.</li>
                <li>Копия ссылки и подтверждение приходят на email клиента.</li>
              </ul>
            </article>
          </section>

          <p className="mt-8 max-w-3xl border border-asi-border bg-asi-paper px-4 py-3 text-sm leading-relaxed text-asi-navy/70">
            {YOOKASSA_PENDING_REVIEW_MESSAGE}
          </p>

          <p className="mt-6 text-sm">
            <a
              href={LOCATION_REPORT_PRODUCT_PATH}
              className="font-sans font-semibold text-asi-navy underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-asi-navy"
            >
              ← К оценке объекта
            </a>
          </p>
        </div>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}
