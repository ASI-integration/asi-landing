import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.join(__dirname, '../../..', '..');
const ruPagePath = path.join(repoRoot, 'src/app/ru/location-analysis/page.tsx');
const demoComponentPath = path.join(repoRoot, 'src/components/LocationIntelligenceDemo.tsx');

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

describe('RU /ru/location-analysis public demo UI contract', () => {
  it('page CTA uses new copy and drops legacy headline', () => {
    const pageSrc = fs.readFileSync(ruPagePath, 'utf8');
    const demoSrc = fs.readFileSync(demoComponentPath, 'utf8');
    const combined = `${pageSrc}\n${demoSrc}`;
    expect(pageSrc).toContain('Хотите понять, как использовать эту локацию?');
    expect(combined).not.toContain('Получить подробный разбор');
    expect(countOccurrences(combined, 'Получить полный отчёт')).toBeGreaterThanOrEqual(1);
    expect(pageSrc).not.toContain('Объект выглядит перспективным?');
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
