import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruComplianceRoutes } from '@/config/ruCompliance';
import { ruNavMainLinks } from '@/config/ruNav';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU-02/RU-03 closed-beta spine + pilot boundary', () => {
  it('homepage primary acquisition path points to RU self-service connection', () => {
    const home = readSrc('src/app/ru/page.tsx');
    const cta = readSrc('src/components/ru/ConnectCta.tsx');

    expect(cta).toContain("RU_CONNECT_HREF = '/ru/connect'");
    expect(cta).toContain("RU_SPECIAL_OFFER_HREF = '#special-offer'");
    expect(home).toContain('RU_CONNECT_HREF');
    expect(home).toContain('RU_SPECIAL_OFFER_HREF');
    expect(home.match(/<ConnectCta\b/g) ?? []).toHaveLength(4);
    expect(home).toContain('id="how-it-works"');
    expect(home).toContain('id="special-offer"');
    expect(home).not.toContain('id="pricing"');
    expect(home).toContain('id="pilot-form"');
    expect(home).toContain('RuCommercialTimeline');
    expect(home).toContain('Без оплаты на старте');
    expect(home).not.toMatch(/COMMUNICATION_PILOT_PRICE_RUB|12 месяцев|Стригунова/);
    expect(home).not.toContain('RU_LOCATION_CHECK_HREF');
    expect(home).not.toContain('Оценка локации — отдельный инструмент');
  });

  it('routes RU acquisition and login CTAs to /ru/connect without moving Пилот or legal/location', () => {
    const header = readSrc('src/components/ru/RuPublicNavHeader.tsx');
    const desktop = header.slice(
      header.indexOf('hidden lg:flex items-center gap-4'),
      header.indexOf('lg:hidden inline-flex'),
    );
    const mobile = header.slice(header.indexOf('{open ? ('));

    expect(header).toContain("href: RU_CONNECT_HREF");
    expect(header).toContain("label: 'Войти / подключить'");
    expect(header).not.toContain("href: '/ru/early-access'");
    expect(desktop).toContain('href={RU_CONNECT_HREF}');
    expect(desktop).toContain('Войти');
    expect(desktop).not.toContain('href="/login"');
    expect(mobile).toContain('href={RU_CONNECT_HREF}');
    expect(mobile).toContain('Войти');
    expect(mobile).not.toContain('href="/login"');

    const how = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(how.match(/<BrandPrimaryCta href=\{RU_CONNECT_HREF\}>/g) ?? []).toHaveLength(2);
    expect(how).not.toContain("PILOT_HREF = '/ru/early-access'");

    const home = readSrc('src/app/ru/page.tsx');
    expect(home.match(/href=\{RU_SPECIAL_OFFER_HREF\}/g) ?? []).toHaveLength(3);
    expect(home).toContain("href: '/ru#special-offer'");
    expect(home).toContain('testId="continue-connection"');
    expect(home).toContain("primaryCta={{ href: RU_CONNECT_HREF, label: 'Войти / подключить' }}");

    expect(ruNavMainLinks).toContainEqual({ href: '/ru/early-access', label: 'Пилот' });
    expect(ruNavMainLinks.map((link) => link.href)).toEqual([
      '/ru',
      '/ru/early-access',
      '/ru/how-it-works',
      '/ru/otchet-po-dohodnosti-obektov',
    ]);
    expect(ruComplianceRoutes).toEqual({
      contacts: '/ru/contacts',
      payment: '/ru/payment',
      refund: '/ru/refund',
      privacy: '/ru/privacy',
      offer: '/ru/offer',
      personalDataConsent: '/ru/personal-data-consent',
    });
  });

  it('location remains secondary and nav does not promote engineering /pilot', () => {
    const navHrefs = ruNavMainLinks.map((l) => l.href as string);
    expect(navHrefs).toEqual([
      '/ru',
      '/ru/early-access',
      '/ru/how-it-works',
      '/ru/otchet-po-dohodnosti-obektov',
    ]);
    expect(navHrefs).not.toContain('/pilot');
    expect(navHrefs).not.toContain('/connect');
    expect(navHrefs).not.toContain('/login');

    const nav = readSrc('src/config/ruNav.ts');
    expect(nav).not.toMatch(/['"]\/pilot['"]/);

    const header = readSrc('src/components/ru/RuPublicNavHeader.tsx');
    expect(header).toContain('ruNavMainLinks');
    expect(header).not.toMatch(/href=["']\/pilot["']/);
    expect(header).toMatch(/Login remains utility/i);
    expect(header).toContain("label: 'Войти / подключить'");
    expect(header).toContain('href: RU_CONNECT_HREF');
    expect(header).not.toContain("href: '/ru/early-access'");
    expect(header).not.toContain('href="/login"');
    expect(header.match(/href=\{RU_CONNECT_HREF\}/g) ?? []).toHaveLength(2);

    const bottom = readSrc('src/components/ru/RuBottomQuickLinks.tsx');
    expect(bottom).not.toMatch(/['"]\/pilot['"]/);
  });

  it('keeps engineering /pilot intact and noindex for public discovery boundary', () => {
    const pilotPage = readSrc('src/app/pilot/page.tsx');
    expect(pilotPage).toContain('PilotConsoleClient');
    expect(pilotPage).toContain('index: false');
    expect(pilotPage).toContain('follow: false');
    expect(pilotPage).toContain('Not the commercial customer pilot');

    const client = readSrc('src/app/pilot/PilotConsoleClient.tsx');
    expect(client).toContain('/api/pilot/session');
    expect(client).toContain('/api/pilot/tasks');
  });

  it('keeps current pilot and future scope explicit on supporting RU pages', () => {
    const how = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(how).toContain('Подключить объект бесплатно');
    expect(how).toContain('RU_CONNECT_HREF');
    expect(how).not.toContain("PILOT_HREF = '/ru/early-access'");
    expect(how).toContain('Подключение и настройка — 0');
    expect(how).toContain('14 дней работы на объекте — 0');
    expect(how).toContain('id="roadmap"');
    expect(how).toContain('ROADMAP_ITEMS');
    expect(how).toContain('Направления продукта вне текущего пилота');
    expect(how).not.toContain('Оплата пилота');
    expect(how).not.toContain('Платный MVP');
    expect(how).not.toContain('1 объект · 1 месяц');
    expect(how).not.toMatch(/['"]\/pilot['"]/);

    const early = readSrc('src/app/ru/early-access/page.tsx');
    expect(early).toContain("label: 'Сейчас в пилоте'");
    expect(early).toContain("label: 'Позже'");
    expect(early).toContain('Подключить объект бесплатно');
    expect(early).toContain('Подключение и настройка — 0');
    expect(early).toContain('14 дней реальной работы — 0');
    expect(early).not.toContain('PilotCheckoutCta');
    expect(early).not.toContain('Оплата пилота');
    expect(early).not.toContain('Платный MVP');
    expect(early).not.toContain('1 объект · 1 месяц');
    expect(early).not.toMatch(/['"]\/pilot['"]/);
    expect(early).not.toContain('Уже можно подключить');
    expect(early).not.toContain('Автоматические цены на ночь');
  });

  it('preserves canonical tariff from merchant readiness', () => {
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');
    expect(COMMUNICATION_PILOT_PAYMENT_DESCRIPTION).toContain('1 объект');
    expect(COMMUNICATION_PILOT_PAYMENT_DESCRIPTION).toContain('1 месяц');

    const home = readSrc('src/app/ru/page.tsx');
    const early = readSrc('src/app/ru/early-access/page.tsx');
    expect(home).not.toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(early).not.toContain('COMMUNICATION_PILOT_PRICE_RUB');
  });
});
