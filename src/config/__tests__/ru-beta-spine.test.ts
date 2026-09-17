import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('homepage primary acquisition path points to communications pilot', () => {
    const home = readSrc('src/app/ru/page.tsx');
    expect(home).toContain("ctaHref: PILOT_HREF");
    expect(home).toContain("const PILOT_HREF = '/ru/early-access'");
    expect(home).toContain("ctaLabel: 'Подключить пилот'");
    expect(home).toContain('AI-ответы гостям');
    expect(home).toContain('Сейчас / пилот');
    expect(home).toContain('Дорожная карта платформы');
    // Primary CTA must not lead to location scoring
    expect(home).not.toMatch(/ctaHref:\s*RU_LOCATION_CHECK_HREF/);
    expect(home).toContain('Оценка локации — отдельный инструмент');
    expect(home).toContain('Дополнительно');
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
    expect(header).toContain('Login is utility navigation');

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

  it('labels CURRENT MVP vs ROADMAP on how-it-works and early-access', () => {
    const how = readSrc('src/app/ru/how-it-works/page.tsx');
    expect(how).toContain('Сейчас / пилот');
    expect(how).toContain('Дорожная карта платформы');
    expect(how).toContain('Подключить пилот');
    expect(how).toContain('/ru/early-access');
    expect(how).not.toMatch(/['"]\/pilot['"]/);
    expect(how).toMatch(/не «полная автоматизация объекта на 99%»|не.*99%/);

    const early = readSrc('src/app/ru/early-access/page.tsx');
    expect(early).toContain("label: 'Сейчас в пилоте'");
    expect(early).toContain("label: 'Дорожная карта'");
    expect(early).toContain('Подключить пилот');
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
    expect(home).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(early).toContain('COMMUNICATION_PILOT_PRICE_RUB');
  });
});
