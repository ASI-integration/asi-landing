import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU merchant host isolation + tariff readiness', () => {
  it('publishes verified seller fields without placeholders', () => {
    expect(ruCompliance.fullName).toBe('Реутова Юлия Игоревна');
    expect(ruCompliance.inn).toBe('235307941957');
    expect(ruCompliance.email).toContain('@');
    expect(ruCompliance.phone).toBe('+7 995 889-49-03');
    expect(ruCompliance.phoneTel).toBe('+79958894903');
    expect(ruCompliance.address).toBe(
      'Ленинградская область, г. Мурино, ул. Оборонная, д. 37, корп. 1',
    );
    expect(ruCompliance.ogrn).toBeNull();

    const contacts = readSrc('src/app/ru/contacts/page.tsx');
    expect(contacts).toContain('ruCompliance.phone');
    expect(contacts).toContain('ruCompliance.address');
    expect(contacts).not.toContain('сделаем позже');
  });

  it('keeps legacy payment constants internal and removes them from public promises', () => {
    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');
    expect(COMMUNICATION_PILOT_PAYMENT_DESCRIPTION).toContain('1 объект');
    expect(COMMUNICATION_PILOT_PAYMENT_DESCRIPTION).toContain('1 месяц');

    const earlyAccess = readSrc('src/app/ru/early-access/page.tsx');
    const payment = readSrc('src/app/ru/payment/page.tsx');
    expect(earlyAccess).not.toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(payment).not.toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(payment).toContain('покажем до подтверждения');
  });

  it('exposes RU legal routes only via RU compliance surfaces', () => {
    expect(ruComplianceRoutes).toEqual({
      contacts: '/ru/contacts',
      payment: '/ru/payment',
      refund: '/ru/refund',
      privacy: '/ru/privacy',
      offer: '/ru/offer',
      personalDataConsent: '/ru/personal-data-consent',
    });

    const ruFooter = readSrc('src/components/ru/RuComplianceFooter.tsx');
    expect(ruFooter).toContain('ruComplianceRoutes.payment');
    expect(ruFooter).toContain('ruComplianceRoutes.contacts');
    expect(ruFooter).toContain('ruComplianceRoutes.personalDataConsent');
    expect(ruFooter).toContain('ruCompliance.fullName');
    expect(ruFooter).toContain('ruCompliance.inn');
    expect(ruFooter).toContain('ruCompliance.phone');
    expect(ruFooter).toContain('ruCompliance.address');
  });

  it('does not leak RU merchant/legal links into shared SiteFooter', () => {
    const siteFooter = readSrc('src/components/site/SiteFooter.tsx');
    expect(siteFooter).not.toContain('Legal (RU)');
    expect(siteFooter).not.toMatch(/\/ru\/(payment|contacts|offer|refund|privacy|early-access)/);
    expect(siteFooter).not.toContain('Реутова');
    expect(siteFooter).not.toContain('235307941957');
    expect(siteFooter).not.toContain('889-49-03');
    expect(siteFooter).not.toContain('Мурино');
    expect(siteFooter).not.toContain('YooKassa');
    expect(siteFooter).not.toContain('ЮKassa');
  });

  it('keeps Julia merchant identity off non-RU marketing pages', () => {
    const nonRuPages = [
      'src/app/page.tsx',
      'src/app/media/page.tsx',
      'src/app/markets/japan/page.tsx',
      'src/components/site/SiteFooter.tsx',
    ];
    for (const path of nonRuPages) {
      const src = readSrc(path);
      expect(src).not.toContain('Реутова');
      expect(src).not.toContain('235307941957');
      expect(src).not.toContain('889-49-03');
      expect(src).not.toContain('Оборонная');
      expect(src).not.toContain('сделаем позже');
    }
  });
});
