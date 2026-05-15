import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.join(__dirname, '../../..', '..');
const ruHomePath = path.join(repoRoot, 'src/app/ru/page.tsx');
const ruPagePath = path.join(repoRoot, 'src/app/ru/location-analysis/page.tsx');
const ruReportProductPath = path.join(repoRoot, 'src/app/ru/otchet-po-dohodnosti-obektov/page.tsx');
const ruReportShellPath = path.join(repoRoot, 'src/components/location/LocationStandaloneFullReport.tsx');
const demoComponentPath = path.join(repoRoot, 'src/components/LocationIntelligenceDemo.tsx');

const reportMarketingSourcePaths = [
  ruHomePath,
  ruPagePath,
  ruReportProductPath,
  ruReportShellPath,
  demoComponentPath,
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
  it('page CTA uses new copy and drops legacy headline', () => {
    const pageSrc = fs.readFileSync(ruPagePath, 'utf8');
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const combined = `${pageSrc}\n${demoSrc}`;
    expect(pageSrc).toContain('Хотите понять, как использовать эту локацию?');
    expect(combined).not.toContain('Получить подробный разбор');
    expect(pageSrc).toContain('Получить общий вывод');
    expect(pageSrc).toContain('Перейти к подробному отчёту');
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
    expect(reportProductSrc).toContain('Проверить объект по адресу');
    expect(reportProductSrc).toContain('Получить общий вывод');
    expect(reportProductSrc).toContain('Запросить подробный отчёт');

    for (const forbidden of forbiddenReportMarketingCopy) {
      expect(combined, `RU report marketing copy must not contain «${forbidden}»`).not.toContain(forbidden);
    }
  });

  it('public RU marketing pages do not show public price cards', () => {
    const publicMarketingSrc = [
      ruHomePath,
      ruPagePath,
      ruReportProductPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicMarketingSrc).not.toContain('12 900 ₽ / объект / месяц');
    expect(publicMarketingSrc).not.toContain('8 900 ₽ / объект / месяц');
    expect(publicMarketingSrc).not.toContain('По запросу');
    expect(publicMarketingSrc).toContain('Форматы доступны в личном кабинете');
    expect(publicMarketingSrc).toContain('Перейти в личный кабинет');
  });

  it('public RU report pages describe general and detailed reports', () => {
    const publicReportSrc = [
      ruPagePath,
      ruReportProductPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicReportSrc).toContain('Что входит в общий отчёт');
    expect(publicReportSrc).toContain('Что входит в подробный отчёт');
    expect(publicReportSrc).toContain(
      'Общий отчёт помогает быстро понять потенциал объекта и принять первое решение на данных.',
    );
    expect(publicReportSrc).toContain(
      'Подробный отчёт доступен в личном кабинете и сохраняется как отдельная страница',
    );
  });

  it('detailed report CTAs route to the existing login/dashboard flow', () => {
    const publicReportSrc = [
      ruHomePath,
      ruPagePath,
      ruReportProductPath,
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(publicReportSrc).toContain("const DASHBOARD_LOGIN_HREF = '/login'");
    expect(publicReportSrc).toMatch(/href=\{DASHBOARD_LOGIN_HREF\}[\s\S]{0,500}Перейти к подробному отчёту/);
    expect(publicReportSrc).toMatch(/href=\{DASHBOARD_LOGIN_HREF\}[\s\S]{0,500}Открыть личный кабинет/);
    expect(publicReportSrc).toMatch(/href=\{DASHBOARD_LOGIN_HREF\}[\s\S]{0,500}Запросить подробный отчёт/);
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
});
