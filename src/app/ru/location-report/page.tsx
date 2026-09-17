import Link from 'next/link';
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
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Полный отчёт по локации — ASI',
  description:
    'Подробный отчёт по локации открывается по личной ссылке. Сначала оцените адрес и получите общий вывод.',
};

const ANALYSIS_HREF = '/ru/location-analysis?mode=residential#location-check';

export default function RuLocationFullReportPage() {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main className="flex-1 px-5 sm:px-8 py-12 sm:py-20">
        <div className="max-w-6xl mx-auto">
          <RuLocationProductNav currentPath="/ru/location-report" />

          <div className="max-w-2xl border border-asi-border bg-asi-paper p-8 sm:p-10">
            <div className="flex items-center gap-3">
              <BrandLogoMark size={28} />
              <span className="font-serif text-lg text-asi-navy">ASI</span>
            </div>
            <p className="mt-6 text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              Полный отчёт
            </p>
            <BrandHeadline as="h1" className="mt-4 text-3xl sm:text-4xl">
              Отчёт открывается по личной ссылке
            </BrandHeadline>
            <BrandGoldRule className="mt-6 mb-6" />
            <p className="text-asi-navy/70 leading-relaxed">
              Сначала введите адрес и получите общий отчёт по локации. Подробный отчёт доступен в
              личном кабинете.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <BrandPrimaryCta href={LOCATION_REPORT_PRODUCT_PATH}>
                Оценить объект по адресу
              </BrandPrimaryCta>
              <BrandSecondaryCta href={LOCATION_REPORT_SAMPLE_PATH}>
                Посмотреть пример отчёта
              </BrandSecondaryCta>
            </div>
            <p className="mt-5 text-xs text-asi-navy/50 leading-relaxed">
              Для ознакомления можно открыть демонстрационный пример — он показывает структуру
              платного отчёта. Доход не гарантируется.
            </p>
            <p className="mt-4 text-sm">
              <Link
                href={ANALYSIS_HREF}
                className="font-sans font-semibold text-asi-navy underline-offset-4 hover:underline"
              >
                Перейти к проверке адреса →
              </Link>
            </p>
          </div>
        </div>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}
