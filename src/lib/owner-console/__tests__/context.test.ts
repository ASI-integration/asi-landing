import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNER_CONSOLE_EN_HREF, OWNER_CONSOLE_RU_HREF } from '@/lib/owner-console/entry';
import { ownerCommercialOffer, ownerConsoleSearch, resolveOwnerConsoleContext } from '@/lib/owner-console/context';

describe('owner console context', () => {
  it('locks hospitality and English by default on guestautopilot hosts', () => {
    for (const hostname of ['guestautopilot.com', 'www.guestautopilot.com', 'app.guestautopilot.com']) {
      expect(resolveOwnerConsoleContext({ hostname })).toMatchObject({
        lang: 'en',
        vertical: 'hospitality',
        showVerticalSwitcher: false,
      });
    }
  });

  it('keeps the hospitality focus when the guestautopilot host receives another vertical', () => {
    expect(
      resolveOwnerConsoleContext({
        hostname: 'app.guestautopilot.com',
        lang: 'ru',
        vertical: 'platform',
      }),
    ).toMatchObject({ lang: 'ru', vertical: 'hospitality', showVerticalSwitcher: false });
  });

  it('opens the platform switcher on asi-global hosts', () => {
    expect(resolveOwnerConsoleContext({ hostname: 'app.asi-global.ru' })).toMatchObject({
      lang: 'ru',
      vertical: null,
      showVerticalSwitcher: true,
    });
    expect(
      resolveOwnerConsoleContext({
        hostname: 'www.asi-global.ru',
        lang: 'en',
        vertical: 'industrial',
      }),
    ).toMatchObject({ lang: 'en', vertical: 'industrial', showVerticalSwitcher: true });
  });

  it('follows the landing query on an unknown host', () => {
    expect(resolveOwnerConsoleContext({ hostname: 'localhost', lang: 'en', vertical: 'hospitality' })).toMatchObject({
      lang: 'en',
      vertical: 'hospitality',
      showVerticalSwitcher: false,
    });
    expect(resolveOwnerConsoleContext({ hostname: 'localhost', lang: 'ru', vertical: 'platform' })).toMatchObject({
      lang: 'ru',
      vertical: null,
      showVerticalSwitcher: true,
    });
    expect(resolveOwnerConsoleContext({ hostname: 'localhost', lang: 'ru', vertical: 'real_estate' })).toMatchObject({
      lang: 'ru',
      vertical: 'real_estate',
      showVerticalSwitcher: true,
    });
  });

  it('pins commercial terms to the originating host independently of language', () => {
    expect(resolveOwnerConsoleContext({ hostname: 'app.asi-global.ru', lang: 'en' })).toMatchObject({
      lang: 'en',
      market: 'ru',
    });
    expect(resolveOwnerConsoleContext({ hostname: 'app.guestautopilot.com', lang: 'ru' })).toMatchObject({
      lang: 'ru',
      market: 'international',
    });
    expect(resolveOwnerConsoleContext({ hostname: 'localhost', lang: 'ru' })).toMatchObject({ market: 'ru' });
    expect(resolveOwnerConsoleContext({ hostname: 'localhost', lang: 'en' })).toMatchObject({ market: 'international' });
  });

  it('gates the Strigunov offer to the Russian market and keeps demo distinct from a live pilot', () => {
    const ru = ownerCommercialOffer('ru', 'ru');
    expect(ru.heading).toContain('Ярослава Стригунова');
    expect(ru.facts.map((fact) => fact.value)).toEqual(['0 ₽', '14 дней', '1 000 ₽/объект', '12 месяцев']);
    expect(ru.ctaHref).toBe('https://www.asi-global.ru/ru/connect');
    expect(ru.note).toContain('Никакого автоматического перехода на оплату');
    const enOnRuHost = ownerCommercialOffer('ru', 'en');
    expect(enOnRuHost.facts[2].value).toContain('₽');

    const international = ownerCommercialOffer('international', 'en');
    expect(international.heading).toBe('International onboarding');
    expect(international.ctaHref).toBe('https://www.guestautopilot.com/#partner');
    expect(international.facts.map((fact) => fact.value)).not.toContain('1 000 ₽/объект');
    expect(international.note).toContain('No unverified international price');
    const ruOnGlobalHost = ownerCommercialOffer('international', 'ru');
    expect(ruOnGlobalHost.heading).not.toContain('Стригунова');
  });

  it('retains one shared sandbox and localizes the main demo headline', () => {
    const consoleSource = readFileSync(join(process.cwd(), 'src/app/owner/OwnerConsole.tsx'), 'utf8');
    expect(consoleSource).toContain("fetch('/api/owner/demo'");
    expect(consoleSource).toContain('ownerCommercialOffer(context.market, context.lang)');
    expect(consoleSource).toContain('{copy.demoTitle}');
    expect(consoleSource).not.toContain('>Interactive Live Demo</h1>');
  });

  it('points the English header Live Demo link at the hospitality console', () => {
    const header = readFileSync(join(process.cwd(), 'src/components/site/SiteHeader.tsx'), 'utf8');
    expect(header).toContain('OWNER_CONSOLE_EN_HREF');
    expect(header).toContain('Live Demo');
    expect(header).toContain('Partner with ASI');
    expect(OWNER_CONSOLE_EN_HREF).toBe('https://app.guestautopilot.com/owner?lang=en&vertical=hospitality');
    expect(OWNER_CONSOLE_RU_HREF).toBe('https://app.asi-global.ru/owner?lang=ru&vertical=platform');
    const live = header.indexOf('Live Demo');
    const partner = header.indexOf('Partner with ASI');
    expect(live).toBeGreaterThan(-1);
    expect(partner).toBeGreaterThan(live);
  });

  it('writes a stable console query', () => {
    expect(ownerConsoleSearch({ lang: 'en', vertical: 'hospitality' })).toBe('lang=en&vertical=hospitality');
    expect(ownerConsoleSearch({ lang: 'ru', vertical: null }, 'audit')).toBe('lang=ru&vertical=platform&section=audit');
  });
});
