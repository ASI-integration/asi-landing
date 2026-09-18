import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

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

  it('preserves production copy model, pricing constant, and secondary location placement', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(home).toContain('Операции посуточной аренды на автопилоте');
    expect(home).toContain('Подключить объект бесплатно');
    expect(home).toContain('Как работает пилот');
    expect(home).toContain('Операционный слой поверх вашего Менеджера Каналов');
    expect(home).toContain('Обычные ситуации vs Исключения');
    expect(home).toContain('Точность коммуникации и базы знаний');
    expect(home).toContain('От заявки до результата');
    expect(home).toContain('Итоговый 14-дневный отчёт');
    expect(home).toContain('Подключение и настройка — 0');
    expect(home).toContain('14 дней реальной работы — 0');
    expect(home).toContain('Кому подходит ASI');
    expect(home).toContain('Подключите ваш объект к операционному автопилоту');
    expect(home).toContain('Дополнительно');
    expect(home).toContain('Оценка локации — отдельный инструмент');
    expect(home.indexOf('Операционный слой')).toBeLessThan(home.indexOf('Дополнительно'));
    expect(home.indexOf('BrandPrimaryCta href={PILOT_HREF}')).toBeLessThan(
      home.indexOf('BrandSecondaryCta href={RU_LOCATION_CHECK_HREF}'),
    );
    expect(home).not.toContain('[REQUIRES RUNTIME CONFIRMATION]');
    expect(home).not.toContain('90%');
    expect(home).not.toContain('галлюцин');
  });
});
