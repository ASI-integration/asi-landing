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

describe('RU-DESIGN-02 homepage visual migration', () => {
  it('uses shared brand primitives and guestautopilot visual grammar', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(home).toContain('BrandHeadline');
    expect(home).toContain('BrandSection');
    expect(home).toContain('BrandPrimaryCta');
    expect(home).toContain('BrandSecondaryCta');
    expect(home).toContain('BrandShiro');
    expect(home).toContain('BrandLogoMark');
    expect(home).toContain('bg-asi-ivory');
    expect(home).toContain('variant="navy"');
    expect(home).toContain('font-serif');
    expect(home).not.toContain('HeroSection');
    expect(home).not.toContain('rounded-2xl');
    expect(home).not.toContain('Japan');
    expect(home).not.toContain('Micro Hotels');
    expect(home).not.toContain('Hong Kong');
  });

  it('preserves closed-beta offer and secondary location placement', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(home).toContain('COMMUNICATION_PILOT_SERVICE_TITLE');
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');
    expect(home).toContain('1 объект');
    expect(home).toContain('1 месяц');
    expect(home).toContain('Дополнительно');
    expect(home).toContain('Оценка локации — отдельный инструмент');
    expect(home.indexOf('Сейчас в пилоте')).toBeLessThan(home.indexOf('Дорожная карта платформы'));
    expect(home.indexOf('BrandPrimaryCta href={PILOT_HREF}')).toBeLessThan(
      home.indexOf('BrandSecondaryCta href={RU_LOCATION_CHECK_HREF}'),
    );
  });
});
