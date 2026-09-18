import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruNavMainLinks, ruNavComplianceLinks } from '@/config/ruNav';
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

const PUBLIC_RU_PAGES = [
  'src/app/ru/page.tsx',
  'src/app/ru/how-it-works/page.tsx',
  'src/app/ru/early-access/page.tsx',
  'src/app/ru/payment/page.tsx',
  'src/app/ru/offer/page.tsx',
  'src/app/ru/refund/page.tsx',
  'src/app/ru/privacy/page.tsx',
  'src/app/ru/contacts/page.tsx',
  'src/app/ru/otchet-po-dohodnosti-obektov/page.tsx',
  'src/app/ru/location-analysis/page.tsx',
  'src/app/ru/kak-my-ocenivaem-dohodnost-obektov/page.tsx',
  'src/app/ru/location-report/page.tsx',
  'src/app/ru/location-report/sample/page.tsx',
  'src/app/ru/location-report/status/page.tsx',
] as const;

describe('RU-DESIGN-FINAL acceptance', () => {
  it('keeps primary nav journey and isolates engineering /pilot', () => {
    expect(ruNavMainLinks.map((l) => l.href)).toEqual([
      '/ru',
      '/ru/early-access',
      '/ru/how-it-works',
      '/ru/otchet-po-dohodnosti-obektov',
    ]);
    expect(ruNavMainLinks.map((l) => l.label)).toEqual([
      'Главная',
      'Пилот',
      'Как это работает',
      'Оценка локации',
    ]);

    const header = readSrc('src/components/ru/RuPublicNavHeader.tsx');
    expect(header).toContain('Подключить объект бесплатно');
    expect(header).toContain('/ru/early-access');
    expect(header).not.toMatch(/href=\{?['"]\/pilot['"]\}?/);
    expect(header).toContain('ruNavMainLinks');
  });

  it('keeps guest pilot CTA contract separate from location product', () => {
    const home = readSrc('src/app/ru/page.tsx');
    const locationLanding = readSrc('src/app/ru/otchet-po-dohodnosti-obektov/page.tsx');
    const analysis = readSrc('src/app/ru/location-analysis/page.tsx');
    const methodology = readSrc('src/app/ru/kak-my-ocenivaem-dohodnost-obektov/page.tsx');
    const report = readSrc('src/app/ru/location-report/page.tsx');

    expect(home).toContain('Подключить объект бесплатно');
    expect(home).toContain("const FORM_HREF = '/ru#pilot-form'");
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(home).toContain('EarlyAccessObjectForm');
    expect(home).not.toContain('Оценка локации — отдельный инструмент');
    expect(home).not.toContain('Работает вместе с вашим менеджером каналов');

    for (const page of [locationLanding, analysis, methodology, report]) {
      expect(page).toContain('RuPublicNavHeader');
      expect(page).toContain('bg-asi-ivory');
      expect(page).not.toContain('ThemeProvider');
      expect(page).not.toContain('bg-slate-950');
      expect(page).not.toContain('PublicPrimaryCta');
    }

    expect(locationLanding).toContain('Оценить объект по адресу');
    expect(locationLanding).toContain('/ru/location-analysis?mode=residential#location-check');
    expect(locationLanding).toContain('не входит в пилот');
    expect(analysis).toContain('LocationIntelligenceDemo');
    expect(analysis).toContain('LocationTelemetryProvider');
    expect(LOCATION_REPORT_PRODUCT_PATH).toBe('/ru/otchet-po-dohodnosti-obektov');
    expect(LOCATION_REPORT_SAMPLE_PATH).toBe('/ru/location-report/sample');
    expect(report).toContain("'/ru/location-analysis?mode=residential#location-check'");
  });

  it('keeps shared ASI shell and single footer landmark pattern', () => {
    const footer = readSrc('src/components/ru/RuComplianceFooter.tsx');
    expect(footer).toContain('bg-asi-navy');
    expect(footer).toContain('BrandShiro');
    expect(footer).toContain('page shells can own the single');
    expect(footer).not.toMatch(/^\s*<footer[\s>]/m);
    expect(footer).toContain('Политика данных');
    expect(footer).toContain('Оферта');
    expect(footer).not.toContain('>Конфиденциальность<');
    expect(footer).not.toContain('>Условия<');

    const trustNav = readSrc('src/components/ru/RuTrustNav.tsx');
    expect(trustNav).toContain("label: 'Политика данных'");
    expect(trustNav).toContain("label: 'Оферта'");

    expect(ruNavComplianceLinks.some((l) => l.label === 'Политика данных')).toBe(true);
    expect(ruNavComplianceLinks.some((l) => l.label === 'Оферта')).toBe(true);

    const legalLayout = readSrc('src/components/ru/RuLegalPageLayout.tsx');
    expect(legalLayout).toContain('RuPublicNavHeader');
    expect(legalLayout).toContain('RuComplianceFooter');
    expect(legalLayout).toContain('bg-asi-ivory');

    for (const page of PUBLIC_RU_PAGES) {
      const src = readSrc(page);
      expect(src, page).not.toContain('bg-slate-950');
      expect(src, page).not.toContain('ThemeProvider');
      if (src.includes('RuComplianceFooter')) {
        expect(src, `${page} should wrap compliance footer in a page footer landmark`).toMatch(
          /<footer[\s>][\s\S]*RuComplianceFooter/,
        );
      }
    }
  });

  it('keeps brand CTAs keyboard-focusable and homepage metadata truthful', () => {
    const primitives = readSrc('src/components/site/primitives.tsx');
    const tokens = readSrc('src/config/brand/tokens.ts');
    expect(primitives).toContain('focus-visible:outline');
    expect(tokens).toContain('focus-visible:outline');

    const home = readSrc('src/app/ru/page.tsx');
    const how = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(home).toContain('export const metadata');
    expect(home).toContain('общение с гостями по данным объекта');
    expect(home).not.toContain('Полная операционная автоматизация');
    expect(home).toContain('Подключить объект бесплатно');
    expect(home).toContain('Подключение и настройка — 0');
    expect(home).toContain('14 дней работы на объекте — 0');
    expect(home).not.toContain('Оплата пилота');
    expect(home).not.toContain('Платный MVP');
    expect(home).not.toContain('1 объект · 1 месяц');
    expect(home).not.toContain('PilotCheckoutCta');
    expect(how).toContain('export const metadata');
    expect(how).toContain('Как работает ASI');
    expect(how).toContain('Управлять посуточными квартирами — не значит весь день сидеть в чатах');
  });

  it('migrates sample/status public shells off dark-slate SaaS chrome', () => {
    const sample = readSrc('src/app/ru/location-report/sample/page.tsx');
    const status = readSrc('src/app/ru/location-report/status/page.tsx');
    const statusClient = readSrc('src/app/ru/location-report/status/StatusProgressClient.tsx');

    for (const src of [sample, status]) {
      expect(src).toContain('RuPublicNavHeader');
      expect(src).toContain('bg-asi-ivory');
      expect(src).toContain('RuLocationProductNav');
      expect(src).not.toContain('bg-slate-950');
      expect(src).not.toContain('rounded-3xl');
    }

    expect(status).toContain('К проверке адреса');
    expect(status).toContain('location-analysis');
    expect(statusClient).not.toContain('bg-slate-950');
    expect(statusClient).toContain('role="status"');
  });

  it('does not leak RU merchant surfaces into guestautopilot site chrome', () => {
    const siteFooter = readSrc('src/components/site/SiteFooter.tsx');
    expect(siteFooter).not.toContain('Реутова');
    expect(siteFooter).not.toContain('/ru/payment');
    expect(siteFooter).not.toContain('Политика данных');
    expect(siteFooter).not.toContain(`${COMMUNICATION_PILOT_PRICE_RUB}`);
  });

  it('hides root LegalFooter on RU host homepage path `/`', () => {
    const gate = readSrc('src/components/FooterGate.tsx');
    expect(gate).toContain("pathname === '/'");
    expect(gate).toContain('isRuHost');
    const homeMeta = readSrc('src/app/page.tsx');
    expect(homeMeta).toContain('операции посуточной аренды на автопилоте');
    expect(homeMeta).not.toContain('Полная операционная автоматизация');
  });
});
