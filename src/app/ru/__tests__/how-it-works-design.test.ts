import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU-DESIGN-04 how-it-works visual migration', () => {
  it('uses shared brand primitives and ASI editorial grammar', () => {
    const page = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(page).toContain('BrandHeadline');
    expect(page).toContain('BrandSection');
    expect(page).toContain('BrandPrimaryCta');
    expect(page).toContain('BrandSecondaryCta');
    expect(page).toContain('BrandShiro');
    expect(page).toContain('BrandLogoMark');
    expect(page).toContain('bg-asi-ivory');
    expect(page).toContain('variant="navy"');
    expect(page).toContain('font-serif');
    expect(page).not.toContain('ThemeProvider');
    expect(page).not.toContain('rounded-2xl');
    expect(page).not.toContain('Japan');
    expect(page).not.toContain('Micro Hotels');
    expect(page).not.toContain('Hong Kong');
  });

  it('preserves current vs roadmap semantics and pilot conversion', () => {
    const page = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(page).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(page).toContain('COMMUNICATION_PILOT_SERVICE_TITLE');
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');
    expect(page).toContain('NOW_ITEMS');
    expect(page).toContain('ROADMAP_ITEMS');
    expect(page).toContain('Сейчас / пилот');
    expect(page).toContain('Дорожная карта платформы');
    expect(page).toContain('Направление платформы');
    expect(page).toContain('Отдельный инструмент');
    expect(page).toContain('Подключить объект бесплатно');
    expect(page).toContain('/ru/early-access');
    expect(page).toContain('id="current-pilot"');
    expect(page).toContain('23:07');
    expect(page).toContain('Начните с одного объекта');
    expect(page).toMatch(/не «полная автоматизация объекта на 99%»|не.*99%/);
    expect(page).not.toMatch(/['"]\/pilot['"]/);
    expect(page.indexOf('Сейчас / пилот')).toBeLessThan(page.indexOf('Дорожная карта платформы'));
  });
});
