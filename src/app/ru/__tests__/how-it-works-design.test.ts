import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

const LEGACY_PILOT_PRICE_PATTERNS = [
  'Оплата пилота',
  'Платный MVP',
  'Тариф пилота',
  '1 объект · 1 месяц',
  '1 объект, 1 месяц',
  '1 объект / 1 месяц',
  `${COMMUNICATION_PILOT_PRICE_RUB} ₽ · 1 объект · 1 месяц`,
  `${COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц`,
] as const;

describe('RU how-it-works plain-language copy', () => {
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

  it('tells the plain-language conversion story before de-emphasized roadmap', () => {
    const page = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(page).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(page).toContain('Управлять посуточными квартирами — не значит весь день сидеть в чатах');
    expect(page).toContain('Подключить объект бесплатно');
    expect(page).toContain('/ru/early-access');
    expect(page).toContain('Чем больше объектов в управлении');
    expect(page).toContain('Больше квартир → Больше сообщений → Больше администраторов');
    expect(page).toContain('ASI берёт на себя повторяющиеся операции');
    expect(page).toContain('«Как подключиться к Wi-Fi?»');
    expect(page).toContain('ASI — это не ещё один чат-бот');
    expect(page).toContain('Сначала мы бесплатно настраиваем ваш объект');
    expect(page).toContain('Этот этап не входит в 14 дней пилота');
    expect(page).toContain('Затем ASI работает на вашем реальном объекте 14 дней');
    expect(page).toContain('По итогам — результат, а не обещания');
    expect(page).toContain('Прозрачные условия');
    expect(page).toContain('Подключение и настройка — 0');
    expect(page).toContain('14 дней работы на объекте — 0');
    expect(page).toContain('После пилота');
    expect(page).toContain('Никакого автоматического перехода на оплату после пилота');
    expect(page).toContain('Хотите посмотреть, как это сработает на ваших объектах?');
    expect(page).toContain('Система занимается повторяемым. Человек — решениями.');
    expect(page).not.toContain('Рутина движется автоматически');
    expect(page).not.toContain('операционный слой');
    expect(page).not.toContain('операционный контур');
    expect(page).not.toContain('модель платформы');
    expect(page).not.toContain('куда движется платформа');
    expect(page).toContain('id="roadmap"');
    expect(page).toContain('ROADMAP_ITEMS');
    expect(page.indexOf('Чем больше объектов в управлении')).toBeLessThan(page.indexOf('id="roadmap"'));
    expect(page.indexOf('Прозрачные условия')).toBeLessThan(page.indexOf('id="roadmap"'));
    for (const legacy of LEGACY_PILOT_PRICE_PATTERNS) {
      expect(page, `must not present legacy paid-pilot copy: ${legacy}`).not.toContain(legacy);
    }
  });
});
