import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('RU-DESIGN-05 trust/legal visual unification', () => {
  it('migrates shared legal shell to ASI editorial grammar', () => {
    const layout = readSrc('src/components/ru/RuLegalPageLayout.tsx');
    expect(layout).toContain('BrandHeadline');
    expect(layout).toContain('BrandEyebrow');
    expect(layout).toContain('BrandGoldRule');
    expect(layout).toContain('RuTrustNav');
    expect(layout).toContain('bg-asi-ivory');
    expect(layout).toContain('ASI · документы и условия');
    expect(layout).not.toContain('ThemeProvider');
    expect(layout).not.toContain('max-w-2xl mx-auto');
  });

  it('keeps RuTrustNav sourced from ruComplianceRoutes', () => {
    const nav = readSrc('src/components/ru/RuTrustNav.tsx');
    expect(nav).toContain('ruComplianceRoutes.payment');
    expect(nav).toContain('ruComplianceRoutes.offer');
    expect(nav).toContain('ruComplianceRoutes.refund');
    expect(nav).toContain('ruComplianceRoutes.privacy');
    expect(nav).toContain('ruComplianceRoutes.contacts');
    expect(ruComplianceRoutes).toEqual({
      contacts: '/ru/contacts',
      payment: '/ru/payment',
      refund: '/ru/refund',
      privacy: '/ru/privacy',
      offer: '/ru/offer',
    });
  });

  it('preserves merchant identity and payment contract on trust pages', () => {
    const payment = readSrc('src/app/ru/payment/page.tsx');
    const contacts = readSrc('src/app/ru/contacts/page.tsx');
    const offer = readSrc('src/app/ru/offer/page.tsx');
    const refund = readSrc('src/app/ru/refund/page.tsx');
    const privacy = readSrc('src/app/ru/privacy/page.tsx');

    expect(COMMUNICATION_PILOT_PRICE_RUB).toBe(1000);
    expect(payment).toContain('COMMUNICATION_PILOT_PRICE_RUB');
    expect(payment).toContain('COMMUNICATION_PILOT_SERVICE_TITLE');
    expect(payment).toContain('PilotCheckoutCta');
    expect(COMMUNICATION_PILOT_SERVICE_TITLE).toContain('AI-коммуникации');

    for (const src of [payment, contacts, offer, refund, privacy]) {
      expect(src).toContain('ruCompliance.');
      expect(src).toContain('RuLegalPageLayout');
      expect(src).not.toContain('ThemeProvider');
      expect(src).not.toContain('Japan');
      expect(src).not.toContain('Micro Hotels');
    }

    expect(contacts).toContain('ruCompliance.fullName');
    expect(contacts).toContain('ruCompliance.inn');
    expect(contacts).toContain('ruComplianceRoutes.');
    expect(refund).toContain('до 10 рабочих дней');
    expect(privacy).toContain('1. Оператор персональных данных');
    expect(offer).toContain('8. Реквизиты исполнителя');

    expect(ruCompliance.fullName).toContain('Реутова');
    expect(ruCompliance.inn).toBe('235307941957');
  });
});
