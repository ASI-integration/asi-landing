import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import { buildFreeLocationReportViewModel } from '../free-report-renderer';
import { buildLocationDecision } from '../location-decision-kernel';
import { FREE_LOCATION_REPORT_CTA } from '../location-report-structure';
import { publicScoreLabelRuForConfidence } from '../location-evidence-anchor';
import {
  publicLocationScore,
  publicScorePresentationFromDecision,
  publicScoreRange,
} from '../location-score-public';
import type { OSMElement } from '../types';

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
    const decisionBlock = homeSrc.slice(
      homeSrc.indexOf('Как ASI помогает принять решение по объекту'),
      homeSrc.indexOf('{/* ── После проверки локации ── */}'),
    );
    const firstCardTitleIndex = decisionBlock.indexOf('Проверьте объект');
    const secondCardTitleIndex = decisionBlock.indexOf('Примите решение на данных');
    const addressCtaIndex = decisionBlock.indexOf('Оценить объект по адресу');

    expect(homeSrc).not.toContain("ctaLabel: 'Оценить объект по адресу'");
    expect(homeSrc).not.toContain('Оцените потенциал до покупки, запуска или подключения управления ASI.');
    expect(homeSrc).not.toContain('Три шага: проверить адрес');
    expect(homeSrc).not.toContain('Получите вывод по локации');
    expect(homeSrc).not.toContain('Получите общий отчёт по локации');
    expect(decisionBlock).not.toContain('\n                  3\n');
    expect(decisionBlock).toContain('1');
    expect(decisionBlock).toContain('2');
    expect(firstCardTitleIndex).toBeGreaterThan(-1);
    expect(secondCardTitleIndex).toBeGreaterThan(firstCardTitleIndex);
    expect(addressCtaIndex).toBeGreaterThan(firstCardTitleIndex);
    expect(addressCtaIndex).toBeLessThan(secondCardTitleIndex);
    expect(homeSrc).toContain('Сначала проверьте адрес, затем используйте вывод для решения до вложений.');
    expect(homeSrc).toContain(
      'Введите адрес и получите общий вывод по локации: спрос, риски и ближайшие сильные объекты.',
    );
    expect(homeSrc).toContain(
      'Используйте общий вывод, чтобы понять, стоит ли рассматривать объект дальше. Подробный отчёт доступен в личном кабинете.',
    );
    expect(homeSrc.match(/Оценить объект по адресу/g)).toHaveLength(1);
    expect(homeSrc).toContain('href={RU_LOCATION_CHECK_HREF}');
    for (const forbidden of [
      'Request report',
      'Generating',
      'Demo result',
      'Couldn’t start the report',
      'Full report',
    ]) {
      expect(homeSrc, `RU landing must not expose English copy: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('page CTA uses new copy and drops legacy headline', () => {
    const pageSrc = fs.readFileSync(ruPagePath, 'utf8');
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const combined = `${pageSrc}\n${demoSrc}`;
    expect(demoSrc).toContain('Хотите подробный разбор объекта?');
    expect(demoSrc).toContain(
      'Подробный отчёт покажет больше: спрос, риски, конкурентов, стратегию запуска и рекомендации по использованию объекта.',
    );
    expect(combined).not.toContain('Получить подробный разбор');
    expect(pageSrc).not.toContain('Хотите понять, как использовать эту локацию?');
    expect(pageSrc).not.toContain('Как устроен отчёт');
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
    expect(publicMarketingSrc).not.toContain('Форматы доступны');
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
    expect(publicReportSrc).toContain('Получить полный отчёт');
    expect(publicReportSrc).toContain('YOOKASSA_PENDING_REVIEW_MESSAGE');
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

  it('public RU result renders potential range instead of exact score out of 100', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const residentialScoreBlock = demoSrc.slice(
      demoSrc.indexOf('const publicScoreRangeLabel'),
      demoSrc.indexOf('<EvergreenRing index={publicScore}'),
    );

    expect(demoSrc).toContain(
      "import { publicScorePresentationFromDecision } from '@/lib/location/location-score-public'",
    );
    expect(residentialScoreBlock).toContain('publicScorePresentationFromDecision');
    expect(residentialScoreBlock).toContain('residentialLocationDecision ?? analysis.locationDecision');
    expect(residentialScoreBlock).not.toContain('publicScoreRange(publicScore)');
    expect(residentialScoreBlock).toContain('{publicScoreRangeLabel');
    expect(residentialScoreBlock).toContain('{isRuResidentialDemo ? (');
    const ruResidentialBranch = residentialScoreBlock.slice(
      residentialScoreBlock.indexOf('{isRuResidentialDemo ? ('),
      residentialScoreBlock.indexOf(') : (', residentialScoreBlock.indexOf('{isRuResidentialDemo ? (')),
    );
    expect(ruResidentialBranch).toContain('{publicScoreRangeLabel');
    expect(ruResidentialBranch).not.toContain('/100');
    expect(ruResidentialBranch).not.toMatch(/\d+\s*[-–]\s*\d+\s*%/);

    const novorossiysk = { lat: 44.7212, lon: 37.7704 };
    const elements: OSMElement[] = [];
    const analysis = buildAnalysis(elements, novorossiysk.lat, novorossiysk.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск',
      coordinates: novorossiysk,
      rawElements: elements,
      locale: 'ru',
    });
    const publicScore = publicLocationScore(analysis);
    const presentationLabel =
      publicScorePresentationFromDecision(decision, publicScore)?.labelRu ?? '';

    expect(presentationLabel).not.toMatch(/требует полной проверки|данных недостаточно|нужно проверить/i);
    expect(presentationLabel).not.toMatch(/\b\d+\s*\/\s*100\b/);
    if (decision.publicSummary?.publicScoreConfidence === 'sufficient') {
      expect(presentationLabel).toMatch(/Предварительный потенциал:/);
    } else {
      expect(presentationLabel).toMatch(/уточнения|умеренный/i);
    }
    expect(decision.publicSummary?.presentationDiagnostics?.cityLevelStrategicAnchorOnly).toBe(
      true,
    );

    const freeReport = buildFreeLocationReportViewModel({
      address: 'Новороссийск',
      decision,
      analysis,
    });
    expect(freeReport.shortVerdict).not.toMatch(/Слабый спрос/i);

    expect(freeReport.topEvidenceBullets[0]?.isCityLevelStrategic).toBe(true);
    expect(publicScoreRange(72, { confidence: 'sufficient' })?.labelRu).toMatch(/Предварительный потенциал:/);
    expect(freeReport.topEvidenceBullets[0]?.shortReason).toMatch(/городской фактор спроса/i);
    expect(freeReport.topEvidenceBullets[0]?.shortReason).not.toMatch(/полной карте/i);
  });

  it('public hero uses separate score and headline containers without overlapping ring on RU residential', () => {
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    expect(demoSrc).toContain('data-public-hero-score');
    expect(demoSrc).toContain('data-public-hero-headline');
    expect(demoSrc).toContain('data-public-hero-recommendation');
    expect(demoSrc).toContain('data-public-hero-headline');
    expect(demoSrc).toContain('data-public-hero-recommendation');
    expect(demoSrc).toMatch(
      /\{!isRuResidentialDemo \? \([\s\S]*?<EvergreenRing[\s\S]*?\) : null\}/,
    );
    expect(demoSrc).toContain('items-start');
  });

  it('sufficient confidence does not render internal check wording in score label', () => {
    const label = publicScoreLabelRuForConfidence('sufficient', 72);
    expect(label).toMatch(/Предварительный потенциал:/);
    expect(label).not.toMatch(/требует полной проверки|данных недостаточно|нужно проверить/i);
  });

  it('low-confidence public score may use cautious copy', () => {
    const label = publicScoreRange(40, { confidence: 'requires_full_check' })?.labelRu ?? '';
    expect(label).toBe('Потенциал требует уточнения');
    expect(label).toMatch(/уточнения/i);
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
