import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildFreeLocationReportViewModel } from '../free-report-renderer';
import { FREE_LOCATION_REPORT_CTA } from '../location-report-structure';

const repoRoot = path.join(__dirname, '../../..', '..');
const ruHomePath = path.join(repoRoot, 'src/app/ru/page.tsx');
const ruPagePath = path.join(repoRoot, 'src/app/ru/location-analysis/page.tsx');
const ruReportProductPath = path.join(repoRoot, 'src/app/ru/otchet-po-dohodnosti-obektov/page.tsx');
const ruReportShellPath = path.join(repoRoot, 'src/components/location/LocationStandaloneFullReport.tsx');
const demoComponentPath = path.join(repoRoot, 'src/components/LocationIntelligenceDemo.tsx');
const ruGeneralReportCtaPath = path.join(repoRoot, 'src/components/ru/RuGeneralLocationReportCta.tsx');
const dashboardReportsPath = path.join(repoRoot, 'src/app/dashboard/reports/ReportsPageClient.tsx');
const dashboardReportPlaceholderPath = path.join(repoRoot, 'src/app/dashboard/reports/[reportId]/ReportPlaceholderClient.tsx');

const reportMarketingSourcePaths = [
  ruHomePath,
  ruPagePath,
  ruReportProductPath,
  ruReportShellPath,
  demoComponentPath,
  ruGeneralReportCtaPath,
] as const;

const forbiddenReportMarketingCopy = [
  'Объект выглядит перспективным',
  'если объект подходит',
  'если объект перспективен',
  'искать другой вариант',
  'неперспективный объект',
  'не стоит запускать',
  'слабый объект',
  'стоит ли запускать',
  'локация выглядит перспективной',
] as const;

describe('RU /ru/location-analysis public demo UI contract', () => {
  it('RU landing keeps address check CTA inside the first decision step', () => {
    const homeSrc = fs.readFileSync(ruHomePath, 'utf8');

    expect(homeSrc).not.toContain("ctaLabel: 'Оценить объект по адресу'");
    expect(homeSrc).not.toContain('Оцените потенциал до покупки, запуска или подключения управления ASI.');
    expect(homeSrc).not.toContain('Три шага: проверить адрес');
    expect(homeSrc).not.toContain('Получите вывод по локации');
    expect(homeSrc).not.toContain('Получите общий отчёт по локации');
    expect(homeSrc).toContain('Сначала проверьте адрес, затем используйте вывод для решения до вложений.');
    expect(homeSrc).toContain(
      'Введите адрес и получите общий вывод по локации: спрос, конкуренция, риски и ближайшие сильные объекты.',
    );
    expect(homeSrc).toContain(
      'Используйте общий вывод до покупки, запуска или подключения управления, чтобы не действовать вслепую.',
    );
    expect(homeSrc).toContain('Подробный отчёт доступен в личном кабинете');
    expect(homeSrc.match(/Оценить объект по адресу/g)).toHaveLength(1);
    expect(homeSrc).toContain('href={RU_LOCATION_CHECK_HREF}');
  });

  it('page CTA uses new copy and drops legacy headline', () => {
    const pageSrc = fs.readFileSync(ruPagePath, 'utf8');
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const combined = `${pageSrc}\n${demoSrc}`;
    expect(pageSrc).toContain('Хотите понять, как использовать эту локацию?');
    expect(combined).not.toContain('Получить подробный разбор');
    expect(pageSrc).toContain('Оценить объект по адресу');
    expect(pageSrc).not.toContain('Перейти к подробному отчёту');
    expect(pageSrc).not.toContain('Объект выглядит перспективным?');
  });

  it('RU report marketing copy positions the report before any object decision', () => {
    const homeSrc = fs.readFileSync(ruHomePath, 'utf8');
    const reportProductSrc = fs.readFileSync(ruReportProductPath, 'utf8');
    const combined = reportMarketingSourcePaths.map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(homeSrc).toContain('Отчёт нужен до любого решения по объекту');
    expect(homeSrc).toContain(
      'Проверьте локацию, спрос, риски и сценарии монетизации до покупки, запуска посуточной аренды или подключения управления ASI.',
    );
    expect(reportProductSrc).toContain('Оценить объект по адресу');
    expect(reportProductSrc).not.toContain('Запросить подробный отчёт');

    for (const forbidden of forbiddenReportMarketingCopy) {
      expect(combined, `RU report marketing copy must not contain «${forbidden}»`).not.toContain(forbidden);
    }
  });

  it('public RU marketing pages do not show public price cards', () => {
    const publicMarketingSrc = [
      ruHomePath,
      ruPagePath,
      ruReportProductPath,
      ruGeneralReportCtaPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicMarketingSrc).not.toContain('12 900 ₽ / объект / месяц');
    expect(publicMarketingSrc).not.toContain('8 900 ₽ / объект / месяц');
    expect(publicMarketingSrc).not.toContain('По запросу');
    expect(publicMarketingSrc).toContain('Получите общий отчёт по локации');
    expect(publicMarketingSrc).toContain('Оценить объект по адресу');
    expect(publicMarketingSrc).not.toContain('Заказать подробный отчёт');
    expect(publicMarketingSrc).not.toContain('Форматы доступны в личном кабинете');
  });

  it('public RU report pages use the general report CTA', () => {
    const publicReportSrc = [
      ruPagePath,
      ruReportProductPath,
      ruGeneralReportCtaPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicReportSrc).toContain(
      'Введите адрес — ASI покажет общий вывод по объекту: насколько место подходит для посуточной аренды и какие факторы рядом влияют на спрос.',
    );
    expect(publicReportSrc).toContain(
      'Подробный отчёт доступен в личном кабинете после бесплатной проверки адреса.',
    );
    expect(publicReportSrc).not.toContain('Что входит в общий отчёт');
    expect(publicReportSrc).not.toContain('Что входит в подробный отчёт');
  });

  it('detailed report CTA preserves free report context and routes through dashboard reports', () => {
    const publicReportSrc = [
      demoComponentPath,
      dashboardReportsPath,
      dashboardReportPlaceholderPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicReportSrc).toContain('buildDashboardReportRequestHref(context)');
    expect(publicReportSrc).toContain('PENDING_LOCATION_REPORT_STORAGE_KEY');
    expect(publicReportSrc).toContain('freeReportId');
    expect(publicReportSrc).toContain('freeReportPermalink');
    expect(publicReportSrc).toContain('createdAt');
    expect(publicReportSrc).toContain('Заказать подробный отчёт');
    expect(publicReportSrc).toContain('После оплаты отчёт появится в разделе Мои отчёты');
  });

  it('public RU route files do not import purchase core or scoring internals', () => {
    const publicRouteSrc = [
      ruHomePath,
      ruPagePath,
      ruReportProductPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicRouteSrc).not.toMatch(/@\/lib\/location\/purchase/);
    expect(publicRouteSrc).not.toMatch(/@\/lib\/location\/location-scoring/);
    expect(publicRouteSrc).not.toMatch(/@\/lib\/location\/h3/);
  });

  it('LocationIntelligenceDemo omits residential/commercial toggle labels', () => {
    const src = fs.readFileSync(demoComponentPath, 'utf8');
    expect(src).not.toContain('Жилая');
    expect(src).not.toContain('Коммерческая');
  });

  it('Competitor breakdown (Конкурентная среда) is not rendered for RU residential demo', () => {
    const src = fs.readFileSync(demoComponentPath, 'utf8');
    expect(src).toContain('hidden on RU residential free/demo preview');
    expect(src).toMatch(/!isRuResidentialDemo\s*\?\s*\(\s*[\r\n]+\s*<CompetitorBreakdownBlock/);
  });

  it('does not expose demo permalink actions in the public RU demo', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    expect(demoSrc).not.toMatch(/Открыть демо[\u2011\u2010-]permalink/i);
    expect(demoSrc).not.toMatch(/Открыть демо[\u2011\u2010-]перmalink/i);
    expect(demoSrc).not.toContain('пространственный');
  });

  it('uses preliminary helper copy instead of report-sales helper copy', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    expect(demoSrc).toContain('resolveRuDemoTopHelperText');
    expect(demoSrc).not.toContain('Краткая оценка локации. Подробный расчёт доступен в полном отчёте.');
  });

  it('public RU result uses Free Report Renderer for free report contents', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');

    expect(demoSrc).toContain("from '@/lib/location/free-report-renderer'");
    expect(demoSrc).toContain('buildFreeLocationReportViewModel({');
    expect(demoSrc).toContain('freeReport?.topEvidenceBullets');
    expect(demoSrc).toContain('freeReport?.shortVerdict');
    expect(demoSrc).toContain('freeReport?.shortRecommendation');
    expect(demoSrc).not.toContain('residentialUiClaims');
    expect(demoSrc).not.toContain('publicDrivers ?? []).map');
  });

  it('public RU UI does not contain raw/debug/full-report-only sections', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');

    for (const forbidden of [
      'locationClaimTrace',
      'formatLocationDemandKernelDebug',
      'source:LocationPublicSummary',
      'previewRisks',
      'Полная детализация закрыта',
      '>Риски<',
      'Кому подходит',
      'competitorDetails',
      'revenueScenarios',
      'fullUrbanDevelopmentRadar',
      'rawSources',
      'debugTrace',
      'scoreTrace',
      'kernelTrace',
      'fullMagnetList',
      'internalWeights',
      'formulas',
    ]) {
      expect(demoSrc, `public RU source must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('public RU UI shows CTA to detailed report from the free report view model', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const freeReport = buildFreeLocationReportViewModel({
      address: 'Санкт-Петербург, Невский проспект, 88',
    });

    expect(freeReport.structure.cta).toBe(FREE_LOCATION_REPORT_CTA);
    expect(freeReport.cta).toEqual({
      primaryLabel: FREE_LOCATION_REPORT_CTA.primaryLabel,
      primaryHref: FREE_LOCATION_REPORT_CTA.primaryHref,
    });
    expect(demoSrc).toContain('reportCtaLabelRu = freeReport?.cta.primaryLabel');
    expect(demoSrc).toContain('router.push(buildDashboardReportRequestHref(context))');
  });
});
