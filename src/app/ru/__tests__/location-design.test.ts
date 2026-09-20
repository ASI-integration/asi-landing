import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU-DESIGN-06 location product family visual migration', () => {
  it('migrates location landing away from Public* / ThemeProvider', () => {
    const page = readSrc('src/app/ru/otchet-po-dohodnosti-obektov/page.tsx');
    expect(page).toContain('BrandHeadline');
    expect(page).toContain('BrandPrimaryCta');
    expect(page).toContain('RuLocationProductNav');
    expect(page).toContain('bg-asi-ivory');
    expect(page).toContain('Оценить объект по адресу');
    expect(page).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(page).toContain('/ru/kak-my-ocenivaem-dohodnost-obektov');
    expect(page).toContain('не обещаем доход');
    expect(page).toContain('Отдельный инструмент');
    expect(page).not.toContain('ThemeProvider');
    expect(page).not.toContain('PublicSection');
    expect(page).not.toContain('PublicPrimaryCta');
    expect(page).not.toContain('COMMUNICATION_PILOT_PRICE_RUB');
  });

  it('keeps analysis tool mount, mode, and telemetry', () => {
    const page = readSrc('src/app/ru/location-analysis/page.tsx');
    expect(page).toContain('LocationIntelligenceDemo');
    expect(page).toContain('LocationTelemetryProvider');
    expect(page).toContain("searchParams.mode === 'commercial' ? 'commercial' : 'residential'");
    expect(page).toContain('initialMode={mode}');
    expect(page).toContain('edgeToHeader');
    expect(page).toContain('id="location-check"');
    expect(page).toContain('Оценить объект по адресу');
    expect(page).toContain('BrandHeadline');
    expect(page).not.toContain('ThemeProvider');
    expect(page).not.toContain('PublicSection');
    expect(page).not.toContain('Перейти к подробному отчёту');
    expect(page).not.toContain('Объект выглядит перспективным?');
  });

  it('migrates methodology without emoji cards and preserves metrics', () => {
    const page = readSrc('src/app/ru/kak-my-ocenivaem-dohodnost-obektov/page.tsx');
    expect(page).toContain('BrandSection');
    expect(page).toContain('ADR');
    expect(page).toContain('RevPAR');
    expect(page).toContain('Occupancy');
    expect(page).toContain('GOPPAR');
    expect(page).toContain('MPI');
    expect(page).toContain('LOCATION_REPORT_SAMPLE_PATH');
    expect(page).toContain('LOCATION_REPORT_PRODUCT_PATH');
    expect(LOCATION_REPORT_SAMPLE_PATH).toBe('/ru/location-report/sample');
    expect(LOCATION_REPORT_PRODUCT_PATH).toBe('/ru/otchet-po-dohodnosti-obektov');
    expect(page).toContain('Посмотреть пример отчёта');
    expect(page).toContain('Оценить объект по адресу');
    expect(page).not.toContain('ThemeProvider');
    expect(page).not.toContain('📍');
    expect(page).not.toContain('rounded-xl');
  });

  it('migrates report empty state into ASI RU shell', () => {
    const page = readSrc('src/app/ru/location-report/page.tsx');
    expect(page).toContain('RuPublicNavHeader');
    expect(page).toContain('RuComplianceFooter');
    expect(page).toContain('BrandHeadline');
    expect(page).toContain('LOCATION_REPORT_SAMPLE_PATH');
    expect(page).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(page).toContain('Оценить объект по адресу');
    expect(page).toContain('Отчёт открывается по личной ссылке');
    expect(page).toContain('bg-asi-ivory');
    expect(page).not.toContain('bg-slate-950');
    expect(page).not.toContain('rounded-3xl');
  });

  it('migrates sample and status public shells away from dark slate', () => {
    const sample = readSrc('src/app/ru/location-report/sample/page.tsx');
    const status = readSrc('src/app/ru/location-report/status/page.tsx');
    for (const page of [sample, status]) {
      expect(page).toContain('RuPublicNavHeader');
      expect(page).toContain('RuComplianceFooter');
      expect(page).toContain('bg-asi-ivory');
      expect(page).not.toContain('bg-slate-950');
      expect(page).not.toContain('rounded-3xl');
    }
    expect(sample).toContain('LOCATION_REPORT_SAMPLE_PRINT_PATH');
    expect(sample).not.toContain('LOCATION_REPORT_SAMPLE_PDF_PATH');
    expect(sample).toContain('Открыть пример отчёта');
    expect(status).toContain('location-analysis');
  });

  it('keeps primary nav location destination and shared product nav routes', () => {
    const nav = readSrc('src/config/ruNav.ts');
    const productNav = readSrc('src/components/ru/RuLocationProductNav.tsx');
    expect(nav).toContain("href: '/ru/otchet-po-dohodnosti-obektov'");
    expect(nav).toContain("label: 'Оценка локации'");
    expect(productNav).toContain('LOCATION_REPORT_PRODUCT_PATH');
    expect(productNav).toContain('LOCATION_REPORT_SAMPLE_PATH');
    expect(productNav).toContain('/ru/kak-my-ocenivaem-dohodnost-obektov');
    expect(productNav).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(LOCATION_REPORT_PRODUCT_PATH).toBe('/ru/otchet-po-dohodnosti-obektov');
    expect(LOCATION_REPORT_SAMPLE_PATH).toBe('/ru/location-report/sample');
  });
});
