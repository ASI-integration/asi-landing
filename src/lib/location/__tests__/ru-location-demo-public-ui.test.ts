import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.join(__dirname, '../../..', '..');
const ruPagePath = path.join(repoRoot, 'src/app/ru/location-analysis/page.tsx');
const demoComponentPath = path.join(repoRoot, 'src/components/LocationIntelligenceDemo.tsx');

describe('RU /ru/location-analysis public demo UI contract', () => {
  it('page CTA uses new copy and drops legacy headline', () => {
    const src = fs.readFileSync(ruPagePath, 'utf8');
    expect(src).toContain('Хотите понять, как использовать эту локацию?');
    expect(src).toContain('Получить подробный разбор');
    expect(src).toContain('Первичный разбор можно запросить бесплатно.');
    expect(src).not.toContain('Объект выглядит перспективным?');
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
});
